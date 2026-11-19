import { isFallbackAuthActive } from './auth';

declare global {
    interface Window {
        Clerk?: {
            loaded?: boolean;
            session?: {
                getToken: (options?: { skipCache?: boolean }) => Promise<string | null>;
            } | null;
            signOut?: () => Promise<void>;
        };
    }
}

export const UNAUTHORIZED_EVENT = 'netjana:unauthorized';

const CLERK_WAIT_MS = 3000;

// Pages can fire requests before Clerk has loaded; without waiting they would go out with no token.
async function waitForClerk() {
    const deadline = Date.now() + CLERK_WAIT_MS;
    while (!window.Clerk?.loaded && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 50));
    }
}

async function getClerkToken(options?: { skipCache?: boolean }) {
    if (isFallbackAuthActive) return null;
    try {
        await waitForClerk();
        return (await window.Clerk?.session?.getToken(options)) ?? null;
    } catch {
        return null;
    }
}

export const API_BASE_URL = (
    import.meta.env.VITE_API_URL ||
    import.meta.env.VITE_BACKEND_URL ||
    ''
).replace(/\/+$/, '');

export const resolveApiUrl = (url: string): string => {
    if (url.startsWith('http://') || url.startsWith('https://')) {
        return url;
    }
    if (API_BASE_URL) {
        return `${API_BASE_URL}${url.startsWith('/') ? '' : '/'}${url}`;
    }
    return url;
};

export class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

export const apiFetch = async (url: string, options: RequestInit = {}) => {
    const fullUrl = resolveApiUrl(url);
    const token = await getClerkToken();
    const headers = new Headers(options.headers);

    if (!options.body || !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    const callerSetAuth = headers.has('Authorization');
    if (token && !callerSetAuth) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    try {
        let response = await fetch(fullUrl, {
            ...options,
            headers
        });

        // A cached token can expire between requests: try once more with a fresh one before giving up.
        if (response.status === 401 && token && !callerSetAuth) {
            const fresh = await getClerkToken({ skipCache: true });
            if (fresh) {
                headers.set('Authorization', `Bearer ${fresh}`);
                response = await fetch(fullUrl, { ...options, headers });
            }
            if (response.status === 401) window.dispatchEvent(new Event(UNAUTHORIZED_EVENT));
        }

        if (!response.ok) {
            let errorMsg = 'API request failed';
            try {
                const errorData = await response.json();
                errorMsg = errorData.error || errorData.message || errorMsg;
            } catch {
                errorMsg = response.statusText || errorMsg;
            }
            throw new ApiError(errorMsg, response.status);
        }

        return response;
    } catch (error) {
        console.error('API Fetch Error:', error);
        throw error;
    }
};

export const api = {
    get: (url: string) => apiFetch(url, { method: 'GET' }),
    post: (url: string, body: unknown) => apiFetch(url, {
        method: 'POST',
        body: JSON.stringify(body)
    }),
    postForm: (url: string, body: FormData) => apiFetch(url, {
        method: 'POST',
        body
    }),
    put: (url: string, body: unknown) => apiFetch(url, { method: 'PUT', body: JSON.stringify(body) }),
    delete: (url: string) => apiFetch(url, { method: 'DELETE' }),
    patch: (url: string, body: unknown) => apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }),
};

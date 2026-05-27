declare global {
    interface Window {
        Clerk?: {
            session?: {
                getToken: () => Promise<string | null>;
            };
        };
    }
}

async function getClerkToken() {
    try {
        return await window.Clerk?.session?.getToken();
    } catch {
        return null;
    }
}

export class ApiError extends Error {
    status: number;

    constructor(message: string, status: number) {
        super(message);
        this.name = 'ApiError';
        this.status = status;
    }
}

export const apiFetch = async (url: string, options: RequestInit = {}) => {
    const orgId = localStorage.getItem('netjana_tenant_id');
    const token = await getClerkToken();
    const headers = new Headers(options.headers);

    if (!options.body || !(options.body instanceof FormData)) {
        headers.set('Content-Type', 'application/json');
    }

    if (orgId) {
        headers.set('x-organization-id', orgId);
    }

    if (token && !headers.has('Authorization')) {
        headers.set('Authorization', `Bearer ${token}`);
    }

    try {
        const response = await fetch(url, {
            ...options,
            headers
        });

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
    delete: (url: string) => apiFetch(url, { method: 'DELETE' }),
    patch: (url: string, body: unknown) => apiFetch(url, { method: 'PATCH', body: JSON.stringify(body) }),
};

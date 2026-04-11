export const apiFetch = async (url: string, options: RequestInit = {}) => {
    const orgId = localStorage.getItem('netjana_tenant_id');
    
    const headers: Record<string, string> = {
        ...options.headers,
    } as Record<string, string>;

    if (!options.body || !(options.body instanceof FormData)) {
        headers['Content-Type'] = 'application/json';
    }

    if (orgId) {
        headers['x-organization-id'] = orgId;
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
            } catch (e) {
                errorMsg = response.statusText || errorMsg;
            }
            throw new Error(errorMsg);
        }

        return response;
    } catch (error) {
        console.error('API Fetch Error:', error);
        throw error;
    }
};

export const api = {
    get: (url: string) => apiFetch(url, { method: 'GET' }),
    post: (url: string, body: any) => apiFetch(url, { 
        method: 'POST', 
        body: JSON.stringify(body) 
    }),
    postForm: (url: string, body: FormData) => apiFetch(url, {
        method: 'POST',
        body
    }),
    delete: (url: string) => apiFetch(url, { method: 'DELETE' }),
};

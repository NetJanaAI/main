import React, { createContext, useContext, useState, useEffect } from 'react';
import type { Tenant } from '../types';
import { api } from '../lib/api';

interface TenantContextType {
    currentTenantId: string | null;
    currentTenant: Tenant | null;
    tenants: Tenant[];
    setTenantId: (id: string | null) => void;
    refreshTenants: () => Promise<void>;
    isLoading: boolean;
}

const TenantContext = createContext<TenantContextType | undefined>(undefined);

export const TenantProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [currentTenantId, setCurrentTenantId] = useState<string | null>(() => {
        return localStorage.getItem('netjana_tenant_id');
    });
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    const refreshTenants = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/api/admin/tenants');
            if (res.ok) {
                const contentType = res.headers.get('content-type') || '';
                if (!contentType.includes('application/json')) {
                    setTenants([]);
                    return;
                }

                const data = await res.json();
                setTenants(data);
                
                // If no tenant selected but we have some, pick the first one
                if (!currentTenantId && data.length > 0) {
                    const firstId = data[0].id;
                    setCurrentTenantId(firstId);
                    localStorage.setItem('netjana_tenant_id', firstId);
                }
            }
        } catch (e) {
            console.warn('[TenantContext] Tenant API unavailable; continuing without tenant list.', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        refreshTenants();
    }, []);

    const setTenantId = (id: string | null) => {
        setCurrentTenantId(id);
        if (id) {
            localStorage.setItem('netjana_tenant_id', id);
        } else {
            localStorage.removeItem('netjana_tenant_id');
        }
    };

    const currentTenant = tenants.find(t => t.id === currentTenantId) || null;

    return (
        <TenantContext.Provider value={{
            currentTenantId,
            currentTenant,
            tenants,
            setTenantId,
            refreshTenants,
            isLoading
        }}>
            {children}
        </TenantContext.Provider>
    );
};

export const useTenant = () => {
    const context = useContext(TenantContext);
    if (!context) {
        throw new Error('useTenant must be used within a TenantProvider');
    }
    return context;
};

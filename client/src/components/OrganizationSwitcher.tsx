import React from 'react';
import { useTenant } from '../contexts/TenantContext';
import { Building2, ChevronDown } from 'lucide-react';

export const OrganizationSwitcher: React.FC = () => {
    const { currentTenant, tenants, setTenantId, isLoading } = useTenant();
    const [isOpen, setIsOpen] = React.useState(false);

    if (isLoading) return <div className="animate-pulse bg-white/5 w-32 h-8 rounded-lg" />;

    return (
        <div className="relative z-50">
            <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-3 px-4 py-2 glass-panel border-primary/20 hover:border-primary/40 transition-colors"
            >
                <Building2 className="w-4 h-4 text-primary" />
                <span className="text-[10px] font-black uppercase tracking-[2px] truncate max-w-[120px]">
                    {currentTenant?.name || 'Select Org'}
                </span>
                <ChevronDown className={`w-3 h-3 text-white/40 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
            </button>

            {isOpen && (
                <div className="absolute top-full right-0 mt-2 w-56 glass-panel border-white/10 bg-black/90 p-2 shadow-2xl backdrop-blur-xl animate-in fade-in slide-in-from-top-2">
                    <div className="text-[8px] font-black uppercase tracking-[3px] text-white/20 px-3 py-2 border-b border-white/5 mb-1">
                        Select Organization
                    </div>
                    <div className="max-h-[200px] overflow-y-auto custom-scrollbar">
                        {tenants.map(tenant => (
                            <button
                                key={tenant.id}
                                onClick={() => {
                                    setTenantId(tenant.id);
                                    setIsOpen(false);
                                    window.location.reload(); // Quickest way to reset all state for the new tenant
                                }}
                                className={`w-full flex flex-col items-start px-3 py-2 rounded-lg transition-colors mb-1 ${
                                    tenant.id === currentTenant?.id
                                        ? 'bg-primary/20 text-primary'
                                        : 'hover:bg-white/5 text-white/60'
                                }`}
                            >
                                <span className="text-[10px] font-bold uppercase tracking-wider">{tenant.name}</span>
                                <span className="text-[8px] text-white/30 truncate w-full">{tenant.id}</span>
                            </button>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

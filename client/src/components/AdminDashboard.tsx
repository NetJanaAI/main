import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Tenant } from '../types';
import { Building2, Plus, Key, BarChart3, ShieldCheck, Copy, Check, Terminal, ShieldAlert, RefreshCcw, Shield } from 'lucide-react';
import DlqManager from './DlqManager';
import SecurityDashboard from './SecurityDashboard';

type AdminTab = 'tenants' | 'dlq' | 'security';

export const AdminDashboard: React.FC = () => {
    const [tenants, setTenants] = useState<Tenant[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [isCreating, setIsCreating] = useState(false);
    const [newTenantName, setNewTenantName] = useState('');
    const [newTenantQuota, setNewTenantQuota] = useState(100);
    const [createdKey, setCreatedKey] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);
    const [activeTab, setActiveTab] = useState<AdminTab>('tenants');

    const fetchTenants = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/api/admin/tenants');
            if (res.ok) {
                const data = await res.json();
                setTenants(data);
            }
        } catch (e) {
            console.error('[Admin] Failed to fetch tenants:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchTenants();
    }, []);

    const handleCreateTenant = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await api.post('/api/admin/tenants', { 
                name: newTenantName, 
                quota_limit: newTenantQuota 
            });
            const data = await res.json();
            if (res.ok) {
                setCreatedKey(data.apiKey);
                setNewTenantName('');
                fetchTenants();
            } else {
                alert(data.error || 'Failed to create tenant');
            }
        } catch (e) {
            console.error('[Admin] Create failed:', e);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <div className="flex justify-between items-end">
                <div>
                    <h2 className="text-3xl font-serif italic mb-2">Institutional Administration</h2>
                    <p className="text-[10px] font-black uppercase tracking-[4px] text-white/30">
                        Sovereign Governance & Multi-Tenant Management
                    </p>
                </div>
                {activeTab === 'tenants' && !isCreating && (
                    <button
                        onClick={() => setIsCreating(true)}
                        className="flex items-center gap-2 px-6 py-3 bg-primary text-black font-black uppercase tracking-widest text-[10px] hover:bg-primary/80 transition-all rounded-lg"
                    >
                        <Plus className="w-4 h-4" />
                        Provision New Tenant
                    </button>
                )}
            </div>

            {/* Admin Sub-navigation */}
            <div className="flex gap-8 border-b border-white/10">
                <button 
                    onClick={() => setActiveTab('tenants')}
                    className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === 'tenants' ? 'border-primary text-primary' : 'border-transparent text-white/20 hover:text-white/40'}`}
                >
                    Organization Provisioning
                </button>
                <button 
                    onClick={() => setActiveTab('security')}
                    className={`pb-4 text-[10px] font-black uppercase tracking-widest transition-all border-b-2 ${activeTab === 'security' ? 'border-[#3366ff] text-[#3366ff]' : 'border-transparent text-white/20 hover:text-white/40'}`}
                >
                    <div className="flex items-center gap-2">
                        <Shield className="w-3 h-3" />
                        Infrastructure Security
                    </div>
                </button>
            </div>

            {activeTab === 'tenants' ? (
                <>
                {isCreating && (
                <div className="glass-panel p-8 border-primary/20 bg-primary/5 relative overflow-hidden">
                    <div className="absolute top-0 right-0 p-4">
                         <button onClick={() => { setIsCreating(false); setCreatedKey(null); }} className="text-white/20 hover:text-white/60 transition-colors uppercase text-[10px] font-black tracking-widest">Cancel</button>
                    </div>
                    
                    {!createdKey ? (
                        <form onSubmit={handleCreateTenant} className="max-w-md space-y-6">
                            <h3 className="text-sm font-black uppercase tracking-[3px] mb-4 text-primary">Provisioning Protocol</h3>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Organization Name</label>
                                <input
                                    type="text"
                                    value={newTenantName}
                                    onChange={(e) => setNewTenantName(e.target.value)}
                                    placeholder="e.g. Dubai Strategic Port Authority"
                                    className="w-full bg-black/40 border border-white/10 p-4 rounded-lg text-sm focus:outline-none focus:border-primary/40 transition-colors"
                                    required
                                />
                            </div>
                            <div className="space-y-2">
                                <label className="text-[10px] font-black uppercase tracking-widest text-white/40">Initial Scrape Quota</label>
                                <input
                                    type="number"
                                    value={newTenantQuota}
                                    onChange={(e) => setNewTenantQuota(parseInt(e.target.value))}
                                    className="w-full bg-black/40 border border-white/10 p-4 rounded-lg text-sm focus:outline-none focus:border-primary/40 transition-colors"
                                    required
                                />
                            </div>
                            <button
                                type="submit"
                                className="w-full py-4 bg-primary text-black font-black uppercase tracking-[4px] text-xs hover:bg-primary/80 transition-all"
                            >
                                Generate Sovereign Access
                            </button>
                        </form>
                    ) : (
                        <div className="space-y-6">
                            <div className="flex items-center gap-4 text-primary">
                                <ShieldCheck className="w-8 h-8" />
                                <h3 className="text-xl font-serif italic">Access Provisioned Successfully</h3>
                            </div>
                            <div className="p-6 bg-red-500/10 border border-red-500/20 rounded-xl">
                                <p className="text-[10px] font-black uppercase tracking-widest text-red-400 mb-4">
                                    CRITICAL: STORE THIS API KEY SECURELY. IT WILL NEVER BE SHOWN AGAIN.
                                </p>
                                <div className="flex items-center gap-3 bg-black/60 p-4 rounded-lg border border-white/10 group">
                                    <code className="text-primary font-mono text-sm flex-1 truncate">{createdKey}</code>
                                    <button
                                        onClick={() => copyToClipboard(createdKey)}
                                        className="p-2 hover:bg-white/5 rounded-md transition-colors text-white/40 hover:text-primary"
                                    >
                                        {copied ? <Check className="w-4 h-4 text-primary" /> : <Copy className="w-4 h-4" />}
                                    </button>
                                </div>
                            </div>
                            <button
                                onClick={() => { setIsCreating(false); setCreatedKey(null); }}
                                className="px-6 py-2 border border-white/10 text-white/40 hover:text-white/80 text-[10px] font-black uppercase tracking-widest rounded-lg transition-all"
                            >
                                Close Protocol
                            </button>
                        </div>
                    )}
                </div>
            )}

            <div className="grid grid-cols-1 gap-6">
                {isLoading ? (
                    [1, 2, 3].map(i => (
                        <div key={i} className="glass-panel h-24 animate-pulse border-white/5" />
                    ))
                ) : tenants.map(tenant => (
                    <div key={tenant.id} className="glass-panel p-6 border-white/5 hover:border-primary/20 transition-all group overflow-hidden relative">
                        <div className="absolute top-0 right-0 p-6 opacity-5 group-hover:opacity-10 transition-opacity">
                             <Building2 className="w-32 h-32 -mr-8 -mt-8" />
                        </div>
                        
                        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-6 relative z-10">
                            <div className="flex items-center gap-4">
                                <div className="w-12 h-12 rounded-xl glass-panel flex items-center justify-center border-primary/10">
                                    <Building2 className="w-5 h-5 text-primary" />
                                </div>
                                <div>
                                    <h4 className="text-lg font-serif italic mb-1">{tenant.name}</h4>
                                    <div className="flex items-center gap-3 text-[9px] font-black uppercase tracking-widest text-white/30">
                                        <span>ID: {tenant.id.substring(0, 8)}...</span>
                                        <span className="w-1 h-1 bg-white/10 rounded-full" />
                                        <span>Added {new Date(tenant.created_at || '').toLocaleDateString()}</span>
                                    </div>
                                </div>
                            </div>

                            <div className="flex items-center gap-8">
                                <div className="text-right">
                                    <div className="flex items-center gap-2 justify-end mb-1">
                                        <BarChart3 className="w-3 h-3 text-primary" />
                                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Usage Protocol</span>
                                    </div>
                                    <div className="flex items-baseline gap-2">
                                        <span className="text-xl font-bold text-white">{tenant.current_usage || 0}</span>
                                        <span className="text-[10px] text-white/20 font-black">/ {tenant.quota_limit}</span>
                                    </div>
                                    <div className="w-32 h-1 bg-white/5 rounded-full mt-2 overflow-hidden">
                                        <div 
                                            className="h-full bg-primary transition-all duration-1000 shadow-[0_0_8px_rgba(251,191,36,0.5)]" 
                                            style={{ width: `${Math.min(100, ((tenant.current_usage || 0) / tenant.quota_limit) * 100)}%` }}
                                        />
                                    </div>
                                </div>

                                <div className="h-10 w-px bg-white/5" />

                                <div className="flex gap-2">
                                    <button 
                                        onClick={() => {
                                            if (confirm('Rotate API Key? Existing key will be revoked.')) {
                                                api.post(`/api/admin/tenants/${tenant.id}/rotate-key`, {}).then(res => res.json()).then(data => {
                                                    if (data.apiKey) {
                                                        setCreatedKey(data.apiKey);
                                                        setIsCreating(true);
                                                    }
                                                });
                                            }
                                        }}
                                        className="p-3 glass-panel border-white/5 hover:border-orange-500/40 text-white/20 hover:text-orange-400 Transition-all rounded-xl group/rotate"
                                        title="Rotate API Key"
                                    >
                                        <RefreshCcw className="w-4 h-4 group-hover/rotate:rotate-180 transition-transform duration-500" />
                                    </button>
                                    <button 
                                        onClick={() => {
                                            if (confirm(`Execute Vanish Protocol for ${tenant.name}? This will permanently delete all associated data.`)) {
                                                api.delete(`/api/admin/tenants/${tenant.id}/vanish`).then(res => {
                                                    if (res.ok) fetchTenants();
                                                });
                                            }
                                        }}
                                        className="p-3 glass-panel border-white/5 hover:border-red-500/40 text-white/20 hover:text-red-500 transition-all rounded-xl"
                                        title="Execute Vanish Protocol"
                                    >
                                        <ShieldAlert className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ))}
            </div>

            {/* System Integrations & API Keys */}
            <div className="mt-12 glass-panel p-8 border-primary/10 bg-black/40">
                <div className="mb-6 border-b border-white/10 pb-4">
                    <h3 className="text-xl font-serif italic text-white flex items-center gap-3">
                        <Key className="w-5 h-5 text-primary" />
                        System Integrations & Keys
                    </h3>
                    <p className="text-[10px] font-black uppercase tracking-widest text-white/40 mt-2">
                        Configure Core APIs across all Tenants (Gemini AI, Edge Webhooks, Data Resolvers)
                    </p>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
                    {/* Gemini API Key */}
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-black uppercase tracking-widest text-primary mb-1 block">Google Gemini API Key</label>
                            <p className="text-[10px] text-white/40 mb-3">Required for extraction & verity agent scoring.</p>
                            <div className="flex gap-2">
                                <input 
                                    type="password"
                                    placeholder="AIzaSy..."
                                    className="flex-1 bg-black/40 border border-white/10 p-3 rounded-lg text-sm focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
                                />
                                <button className="px-4 py-3 bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-black font-black uppercase tracking-widest text-[10px] transition-all rounded-lg">
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* Edge Webhook */}
                    <div className="space-y-4">
                        <div>
                            <label className="text-xs font-black uppercase tracking-widest text-primary mb-1 block">NetJana.AI Edge Webhook</label>
                            <p className="text-[10px] text-white/40 mb-3">Endpoint for dispatching extracted Lead Capsules.</p>
                            <div className="flex gap-2">
                                <input 
                                    type="url"
                                    placeholder="https://"
                                    className="flex-1 bg-black/40 border border-white/10 p-3 rounded-lg text-sm focus:outline-none focus:border-primary/40 transition-colors placeholder:text-white/20"
                                />
                                <button className="px-4 py-3 bg-primary/10 text-primary border border-primary/20 hover:bg-primary hover:text-black font-black uppercase tracking-widest text-[10px] transition-all rounded-lg">
                                    Save
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
                </>
            ) : activeTab === 'dlq' ? (
                <DlqManager />
            ) : (
                <SecurityDashboard />
            )}
        </div>
    );
};

export default AdminDashboard;

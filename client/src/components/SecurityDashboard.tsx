import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { 
    Shield, 
    Key, 
    Lock, 
    ShieldCheck, 
    History, 
    Globe, 
    Plus, 
    Trash2, 
    RefreshCcw,
    AlertTriangle,
    CheckCircle2
} from 'lucide-react';

interface AllowedIp {
    id: string;
    cidr: string;
    label: string;
    organization_id?: string;
    created_at: string;
}

interface AuditLog {
    id: string;
    actor_id: string;
    action: string;
    resource: string;
    timestamp: string;
    organization_name?: string;
    metadata: any;
}

const SecurityDashboard: React.FC = () => {
    const [ips, setIps] = useState<AllowedIp[]>([]);
    const [auditLogs, setAuditLogs] = useState<AuditLog[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    
    // IP Form
    const [newIp, setNewIp] = useState('');
    const [ipLabel, setIpLabel] = useState('');
    const [isAddingIp, setIsAddingIp] = useState(false);

    const fetchSecurityData = async () => {
        setIsLoading(true);
        try {
            const [ipsRes, auditRes] = await Promise.all([
                api.get('/api/admin/security/ips'),
                api.get('/api/admin/security/audit')
            ]);
            
            if (ipsRes.ok) setIps(await ipsRes.json());
            if (auditRes.ok) setAuditLogs(await auditRes.json());
        } catch (e) {
            console.error('[Security] Fetch failed:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchSecurityData();
    }, []);

    const handleAddIp = async (e: React.FormEvent) => {
        e.preventDefault();
        try {
            const res = await api.post('/api/admin/security/ips', { cidr: newIp, label: ipLabel });
            if (res.ok) {
                setNewIp('');
                setIpLabel('');
                setIsAddingIp(false);
                fetchSecurityData();
            }
        } catch (e) {
            console.error('[Security] Add IP failed:', e);
        }
    };

    const handleDeleteIp = async (id: string) => {
        if (!confirm('Revoke access for this IP?')) return;
        try {
            const res = await api.delete(`/api/admin/security/ips/${id}`);
            if (res.ok) fetchSecurityData();
        } catch (e) {
            console.error('[Security] Delete IP failed:', e);
        }
    };

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500">
            {/* Left Col: Ingress Security */}
            <div className="lg:col-span-12 xl:col-span-4 space-y-6">
                <div className="glass-panel border-white/5 bg-black/40 p-6">
                    <div className="flex items-center justify-between mb-6">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center">
                                <Globe className="w-5 h-5 text-primary" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-[3px] text-white">Ingress Allowlist</h3>
                                <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-0.5">Dynamic Firewall Control</p>
                            </div>
                        </div>
                        <button 
                            onClick={() => setIsAddingIp(!isAddingIp)}
                            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
                        >
                            <Plus className={`w-4 h-4 transition-transform ${isAddingIp ? 'rotate-45' : ''}`} />
                        </button>
                    </div>

                    {isAddingIp && (
                        <form onSubmit={handleAddIp} className="mb-6 p-4 bg-white/5 border border-white/5 rounded-xl space-y-4 animate-in zoom-in-95 duration-200">
                            <div>
                                <label className="text-[9px] font-black uppercase tracking-widest text-white/40 block mb-2">CIDR / IP Address</label>
                                <input 
                                    value={newIp}
                                    onChange={(e) => setNewIp(e.target.value)}
                                    placeholder="e.g. 192.168.1.1 or 0.0.0.0/0"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary/40"
                                />
                            </div>
                            <div>
                                <label className="text-[9px] font-black uppercase tracking-widest text-white/40 block mb-2">Internal Label</label>
                                <input 
                                    value={ipLabel}
                                    onChange={(e) => setIpLabel(e.target.value)}
                                    placeholder="e.g. IndiaMART Collector"
                                    className="w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-xs focus:outline-none focus:border-primary/40"
                                />
                            </div>
                            <button className="w-full py-2 bg-primary text-black text-[10px] font-black uppercase tracking-widest rounded-lg hover:bg-primary/80 transition-colors">
                                Add to Firewall
                            </button>
                        </form>
                    )}

                    <div className="space-y-3">
                        {ips.length === 0 ? (
                            <div className="py-12 text-center opacity-20">
                                <Shield className="w-8 h-8 mx-auto mb-2" />
                                <span className="text-[10px] font-black uppercase tracking-widest">Allowlist is empty</span>
                            </div>
                        ) : (
                            ips.map((ip) => (
                                <div key={ip.id} className="flex items-center justify-between p-3 bg-white/[0.02] border border-white/5 rounded-xl group hover:bg-white/5 transition-colors">
                                    <div>
                                        <div className="text-xs font-mono text-primary">{ip.cidr}</div>
                                        <div className="text-[9px] font-black uppercase tracking-widest text-white/20 mt-1">{ip.label || 'Unlabeled Source'}</div>
                                    </div>
                                    <button 
                                        onClick={() => handleDeleteIp(ip.id)}
                                        className="p-2 opacity-0 group-hover:opacity-100 hover:bg-red-500/10 rounded-lg text-red-500/40 hover:text-red-500 transition-all"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                <div className="glass-panel border-white/5 bg-black/40 p-6 space-y-4">
                    <div className="flex items-center gap-2 text-orange-400">
                        <AlertTriangle className="w-4 h-4" />
                        <span className="text-[10px] font-black uppercase tracking-[2px]">Hardening Notes</span>
                    </div>
                    <p className="text-[10px] text-white/40 leading-relaxed font-bold uppercase tracking-widest">
                        Firewall is currently in <span className="text-white">CO-EXISTENCE</span> mode. Both Database and .env allowlists are active.
                    </p>
                </div>
            </div>

            {/* Right Col: Audit Trail */}
            <div className="lg:col-span-12 xl:col-span-8">
                <div className="glass-panel border-white/5 bg-black/40 h-full flex flex-col overflow-hidden">
                    <div className="p-6 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center">
                                <History className="w-5 h-5 text-indigo-400" />
                            </div>
                            <div>
                                <h3 className="text-sm font-black uppercase tracking-[3px] text-white">Security Audit Log</h3>
                                <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-0.5">Tamper-Evident Immutable Trail</p>
                            </div>
                        </div>
                        <button 
                            onClick={fetchSecurityData}
                            className="p-2 hover:bg-white/5 rounded-lg text-white/40 hover:text-white transition-colors"
                        >
                            <RefreshCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>

                    <div className="flex-1 overflow-y-auto custom-scrollbar">
                        <table className="w-full text-left border-collapse">
                            <thead className="sticky top-0 bg-[#0A0A0A] z-10 shadow-xl">
                                <tr className="bg-white/[0.02]">
                                    <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Event Time</th>
                                    <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Actor</th>
                                    <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Action</th>
                                    <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Resource</th>
                                    <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Organization</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-white/[0.02]">
                                {auditLogs.map((log) => (
                                    <tr key={log.id} className="hover:bg-white/[0.02] transition-colors">
                                        <td className="py-4 px-6">
                                            <div className="text-[10px] font-mono text-white/40">{new Date(log.timestamp).toLocaleString()}</div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="text-[10px] font-mono text-white/60 truncate max-w-[120px]">{log.actor_id}</div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-tighter ${
                                                log.action.includes('ROTATE') ? 'bg-orange-500/20 text-orange-400' :
                                                log.action.includes('DELETE') ? 'bg-red-500/20 text-red-400' :
                                                'bg-emerald-500/20 text-emerald-400'
                                            }`}>
                                                {log.action}
                                            </span>
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="text-[10px] font-mono text-white/40 truncate max-w-[200px]">{log.resource}</div>
                                        </td>
                                        <td className="py-4 px-6">
                                            <div className="text-[10px] font-bold text-white/60">{log.organization_name || 'SYSTEM'}</div>
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SecurityDashboard;

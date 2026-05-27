import React, { useEffect, useState } from 'react';
import { ShieldCheck, Activity, Eye, AlertTriangle } from 'lucide-react';
import { api } from '../lib/api';

interface HealthData {
    blocked_ips_24h: number;
    audit_events_1h: number;
    system_status: 'HEALTHY' | 'DEGRADED';
    observability: string;
}

const SystemHealthWidget: React.FC = () => {
    const [health, setHealth] = useState<HealthData | null>(null);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        const fetchHealth = async () => {
            try {
                setError(null);
                const res = await api.get('/api/telemetry/health');
                if (res.ok) {
                    const data = await res.json();
                    setHealth(data);
                }
            } catch (e) {
                setError(e instanceof Error ? e.message : 'Health telemetry unavailable');
            }
        };

        fetchHealth();
        const interval = setInterval(fetchHealth, 30000); // 30s heartbeat
        return () => clearInterval(interval);
    }, []);

    if (!health && error) {
        return (
            <div className="w-full max-w-7xl flex gap-3 px-4 py-3 bg-red-950/20 border border-red-500/20 rounded-xl mb-6 items-center">
                <AlertTriangle className="w-4 h-4 text-red-400" />
                <span className="text-[10px] font-black uppercase tracking-widest text-red-300">Health telemetry unavailable</span>
                <span className="text-xs text-red-200/60 truncate">{error}</span>
            </div>
        );
    }

    if (!health) return null;

    return (
        <div className="w-full max-w-7xl flex gap-6 px-4 py-3 bg-white/[0.02] border border-white/5 rounded-xl mb-6 items-center overflow-hidden animate-in fade-in slide-in-from-top-2 duration-700">
            <div className="flex items-center gap-2 group">
                <div className={`p-1.5 rounded-lg ${health.system_status === 'HEALTHY' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-red-500/10 text-red-400 animate-pulse'}`}>
                    {health.system_status === 'HEALTHY' ? <ShieldCheck className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />}
                </div>
                <div>
                    <span className="block text-[8px] font-black uppercase tracking-[2px] text-white/30">Registry Integrity</span>
                    <span className={`text-[10px] font-black uppercase tracking-widest ${health.system_status === 'HEALTHY' ? 'text-emerald-400' : 'text-red-400'}`}>
                        {health.system_status}
                    </span>
                </div>
            </div>

            <div className="h-4 w-px bg-white/10" />

            <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-blue-500/10 text-blue-400">
                    <Activity className="w-3.5 h-3.5" />
                </div>
                <div>
                    <span className="block text-[8px] font-black uppercase tracking-[2px] text-white/30">Ingress Firewall</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">
                        {health.blocked_ips_24h} <span className="text-white/20">BLOCKS (24H)</span>
                    </span>
                </div>
            </div>

            <div className="h-4 w-px bg-white/10" />

            <div className="flex items-center gap-2">
                <div className="p-1.5 rounded-lg bg-amber-500/10 text-amber-400">
                    <Eye className="w-3.5 h-3.5" />
                </div>
                <div>
                    <span className="block text-[8px] font-black uppercase tracking-[2px] text-white/30">Observability Sync</span>
                    <span className="text-[10px] font-black uppercase tracking-widest text-white">
                        {health.audit_events_1h} <span className="text-white/20">EVENTS (1H)</span>
                    </span>
                </div>
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-3">
                <div className="flex flex-col items-end">
                    <span className="text-[8px] font-black uppercase tracking-[2px] text-white/20">Observability Tier</span>
                    <span className="text-[9px] font-black uppercase tracking-[3px] text-primary">INSTITUTIONAL_ULTRA</span>
                </div>
                <div className="w-1.5 h-1.5 rounded-full bg-primary animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
            </div>
        </div>
    );
};

export default SystemHealthWidget;

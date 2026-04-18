import { useEffect, useState } from 'react';
import { Database, Zap, Activity, AlertCircle } from 'lucide-react';
import { api } from '../../lib/api';
import IngestLogStream from '../IngestLogStream';

interface SourceTelemetry {
    indiamart: any[];
    workers: any[];
    summary: {
        total_queued: number;
        total_duplicates: number;
        last_updated: string;
    };
}

export default function SourceHealth() {
    const [data, setData] = useState<SourceTelemetry | null>(null);
    const [loading, setLoading] = useState(true);

    const fetchData = async () => {
        try {
            const res = await api.get('/api/telemetry/sources');
            if (res.ok) {
                const json = await res.json();
                setData(json);
            }
        } catch (e) {
            console.error('[SourceHealth] Fetch failed:', e);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        fetchData();
        const interval = setInterval(fetchData, 60000);
        return () => clearInterval(interval);
    }, []);

    if (loading) return (
        <div className="h-[60vh] flex items-center justify-center">
            <Activity className="w-8 h-8 text-primary animate-spin" />
        </div>
    );

    return (
        <div className="space-y-8 animate-in fade-in duration-1000">
            {/* Header / Summary */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                <div className="glass-panel p-6 border-primary/20 bg-primary/5">
                    <span className="text-[10px] font-black uppercase tracking-[3px] text-primary/60 mb-2 block">Global Ingestion Efficiency</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-serif italic text-white">
                            {data?.summary.total_duplicates ? Math.round((data.summary.total_duplicates / (data.summary.total_queued + data.summary.total_duplicates)) * 100) : 0}%
                        </span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Deduplication Rate</span>
                    </div>
                </div>
                <div className="glass-panel p-6 border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-2 block">Active Collectors</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-4xl font-serif italic text-white">3</span>
                        <span className="text-[10px] font-black uppercase tracking-widest text-white/40">Sources Syncing</span>
                    </div>
                </div>
                <div className="glass-panel p-6 border-white/5">
                    <span className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-2 block">Last Heartbeat</span>
                    <div className="flex items-baseline gap-2">
                        <span className="text-sm font-black text-[#D4AF37] uppercase tracking-widest">
                            {data?.summary.last_updated ? new Date(data.summary.last_updated).toLocaleTimeString() : 'N/A'}
                        </span>
                    </div>
                </div>
            </div>

            {/* Main Diagnostics Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Source Funnel: IndiaMART */}
                <div className="glass-panel p-8 border-white/5">
                    <div className="flex items-center gap-3 mb-8">
                        <Database className="w-5 h-5 text-primary" />
                        <h3 className="text-lg font-serif italic text-white">IndiaMART Funnel Diagnostics</h3>
                    </div>
                    
                    <div className="space-y-6">
                        {data?.indiamart.map((day: any) => (
                            <div key={day.date} className="relative">
                                <div className="flex justify-between items-end mb-2">
                                    <span className="text-[10px] font-bold text-white/40">{day.date}</span>
                                    <span className="text-[10px] font-bold text-primary">{day.queued} INGESTED / {day.duplicates} DUPES ({day.dedup_rate})</span>
                                </div>
                                <div className="w-full h-2 bg-white/5 rounded-full overflow-hidden flex">
                                    <div 
                                        className="h-full bg-primary" 
                                        style={{ width: `${(day.queued / (day.queued + day.duplicates || 1)) * 100}%` }}
                                    />
                                    <div 
                                        className="h-full bg-white/10" 
                                        style={{ width: `${(day.duplicates / (day.queued + day.duplicates || 1)) * 100}%` }}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Worker Health */}
                <div className="glass-panel p-8 border-white/5">
                    <div className="flex items-center gap-3 mb-8">
                        <Zap className="w-5 h-5 text-emerald-400" />
                        <h3 className="text-lg font-serif italic text-white">Orchestration Worker Status</h3>
                    </div>

                    <div className="grid grid-cols-1 gap-4">
                        {data?.workers.map((worker: any) => (
                            <div key={worker.type} className="p-4 bg-white/[0.02] border border-white/5 rounded-xl flex items-center justify-between">
                                <div className="flex items-center gap-4">
                                    <div className={`w-2 h-2 rounded-full ${worker.status === 'UP' ? 'bg-emerald-500 animate-pulse shadow-[0_0_8px_rgba(16,185,129,0.5)]' : 'bg-red-500'}`} />
                                    <div>
                                        <span className="block text-xs font-bold text-white uppercase">{worker.type}</span>
                                        <span className="text-[9px] text-white/30 uppercase tracking-[2px]">Last Seen: {new Date(worker.last_heartbeat).toLocaleTimeString()}</span>
                                    </div>
                                </div>
                                <span className={`text-[9px] font-black uppercase tracking-widest px-3 py-1 rounded-full border ${worker.status === 'UP' ? 'border-emerald-500/30 text-emerald-400 bg-emerald-500/5' : 'border-red-500/30 text-red-500 bg-red-500/5'}`}>
                                    {worker.status}
                                </span>
                            </div>
                        ))}

                        {(!data?.workers || data.workers.length === 0) && (
                            <div className="py-12 flex flex-col items-center justify-center text-white/20">
                                <AlertCircle className="w-8 h-8 mb-2" />
                                <p className="text-[10px] font-black uppercase tracking-widest">No Active Canaries Detected</p>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* Ingestion Stream */}
            <div className="mt-8">
                <IngestLogStream />
            </div>
        </div>
    );
}

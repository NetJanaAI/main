import { LayoutGrid, Filter, Cpu, Target, Send, ChevronRight, Activity } from 'lucide-react';
import { motion } from 'framer-motion';
import { useState, useEffect } from 'react';
import { api } from '../../lib/api';

interface PipelineData {
    pipeline: {
        ingested: number;
        merged: number;
        scored: number;
        dispatched: number;
    };
    recentDispatches: Array<{
        id: string;
        channel: string;
        status: string;
        sent_at: string;
        company_name: string;
        intent_score: number;
    }>;
}

export default function IntentPipeline({ market }: { market: 'IN' | 'AE' }) {
    const [data, setData] = useState<PipelineData | null>(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        api.get('/api/analytics/pipeline')
            .then(res => res.json())
            .then(resData => {
                setData(resData);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load pipeline data', err);
                setLoading(false);
            });
    }, []);

    const pipelineSteps = [
        { id: 1, name: 'Registry Ingestion', icon: Filter, count: data?.pipeline.ingested || 0, color: 'text-blue-400', desc: 'Raw signals acquired' },
        { id: 2, name: 'Entity Resolution', icon: Cpu, count: data?.pipeline.merged || 0, color: 'text-purple-400', desc: 'Deduplicated & merged' },
        { id: 3, name: 'Intent Scoring', icon: Target, count: data?.pipeline.scored || 0, color: 'text-[#00ffca]', desc: 'High-friction signals' },
        { id: 4, name: 'Lead Dispatched', icon: Send, count: data?.pipeline.dispatched || 0, color: 'text-emerald-400', desc: 'Routed to CRM' },
    ];

    const recentDispatches = data?.recentDispatches || [];

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <LayoutGrid className="w-6 h-6 text-[#00ffca]" />
                    <h1 className="text-2xl font-black uppercase tracking-widest text-[#00ffca]">Intent Pipeline</h1>
                    <span className="ml-4 px-2 py-1 bg-[#00ffca]/10 border border-[#00ffca]/20 rounded text-[#00ffca] text-[10px] font-black uppercase tracking-widest">
                        {market} Region
                    </span>
                </div>
                <p className="text-xs uppercase tracking-widest text-white/40">
                    Real-time visualization of registry signals converting into sovereign leads.
                </p>
            </header>

            <div className="flex flex-col md:flex-row items-center gap-4 w-full">
                {pipelineSteps.map((step, idx) => {
                    const Icon = step.icon;
                    return (
                        <div key={step.id} className="flex items-center flex-1 w-full relative group">
                            <motion.div
                                initial={{ opacity: 0, y: 20 }}
                                animate={{ opacity: 1, y: 0 }}
                                transition={{ delay: idx * 0.15 }}
                                className="glass-panel p-6 border-white/5 bg-white/[0.02] w-full relative z-10 hover:bg-white/[0.05] hover:border-white/20 transition-all cursor-pointer"
                            >
                                <div className={`w-12 h-12 rounded-xl bg-black/40 border border-white/10 flex items-center justify-center mb-6 ${step.color}`}>
                                    <Icon className="w-6 h-6" />
                                </div>
                                <h3 className="text-xs font-black uppercase tracking-widest text-white/60 mb-1">{step.name}</h3>
                                <p className="text-3xl font-sans italic text-white mb-2">{loading ? '...' : step.count.toLocaleString()}</p>
                                <p className="text-[10px] uppercase tracking-widest text-white/30">{step.desc}</p>

                                <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                    <Icon className="w-24 h-24 -mr-8 -mt-8" />
                                </div>
                            </motion.div>

                            {idx < pipelineSteps.length - 1 && (
                                <div className="hidden md:flex items-center justify-center w-8 text-white/20 z-0">
                                    <ChevronRight className="w-6 h-6" />
                                </div>
                            )}
                        </div>
                    );
                })}
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mt-12">
                <div className="glass-panel p-6 border-white/5 bg-black/40">
                    <h4 className="text-[10px] font-black uppercase tracking-[3px] text-[#00ffca] mb-6">Recent Dispatches</h4>
                    <div className="space-y-4">
                        {loading && <div className="text-white/40 text-xs text-center py-10">Loading dispatches...</div>}
                        {!loading && recentDispatches.length === 0 && (
                            <div className="text-white/40 text-xs text-center py-10">No recent dispatches.</div>
                        )}
                        {!loading && recentDispatches.map((dispatch: any, i: number) => (
                            <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5">
                                <div>
                                    <p className="text-sm font-bold text-white mb-1">{dispatch.company_name}</p>
                                    <p className="text-[10px] uppercase tracking-widest text-white/40">
                                        Score: {dispatch.intent_score} &bull; Channel: {dispatch.channel}
                                    </p>
                                </div>
                                <div className={`flex items-center gap-2 ${dispatch.status === 'SENT' ? 'text-emerald-400' : 'text-orange-400'}`}>
                                    <Send className="w-4 h-4" />
                                    <span className="text-[10px] font-black uppercase tracking-widest">{dispatch.status}</span>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="glass-panel p-6 border-white/5 bg-black/40">
                    <h4 className="text-[10px] font-black uppercase tracking-[3px] text-[#00ffca] mb-6">Pipeline Anomalies</h4>
                    <div className="flex flex-col items-center justify-center h-full py-12 opacity-50">
                        <Activity className="w-12 h-12 text-white/20 mb-4" />
                        <p className="text-[10px] uppercase tracking-widest text-white/40">No anomalies detected in active signals</p>
                    </div>
                </div>
            </div>
        </div>
    );
}

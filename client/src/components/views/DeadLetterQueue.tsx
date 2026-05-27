import { useState, useEffect } from 'react';
import { api } from '../../lib/api';
import { AlertOctagon, RotateCcw, ServerCrash, CheckCircle2 } from 'lucide-react';
import { motion } from 'framer-motion';

export default function DeadLetterQueue() {
    const [items, setItems] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [retryStatus, setRetryStatus] = useState<Record<string, 'retrying' | 'success' | 'error'>>({});

    const fetchDLQ = () => {
        // setLoading(true); // removed to avoid set-state-in-effect sync warning
        api.get('/api/dlq')
            .then(res => res.json())
            .then(data => {
                setItems(data.items || []);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load DLQ', err);
                setLoading(false);
            });
    };

    useEffect(() => {
        api.get('/api/dlq')
            .then(res => res.json())
            .then(data => {
                setItems(data.items || []);
                setLoading(false);
            })
            .catch(err => {
                console.error('Failed to load DLQ', err);
                setLoading(false);
            });
    }, []);

    const handleRetry = async (id: string) => {
        setRetryStatus(prev => ({ ...prev, [id]: 'retrying' }));
        try {
            const res = await api.post(`/api/dlq/${id}/retry`, {});
            if (res.ok) {
                setRetryStatus(prev => ({ ...prev, [id]: 'success' }));
                setTimeout(() => {
                    setItems(prev => prev.filter(item => item.id !== id));
                }, 1500);
            } else {
                setRetryStatus(prev => ({ ...prev, [id]: 'error' }));
            }
        } catch (error) {
            console.error('Retry failed', error);
            setRetryStatus(prev => ({ ...prev, [id]: 'error' }));
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700 pb-20">
            <header className="mb-8">
                <div className="flex items-center justify-between">
                    <div>
                        <div className="flex items-center gap-3 mb-2">
                            <ServerCrash className="w-6 h-6 text-orange-500" />
                            <h1 className="text-2xl font-black uppercase tracking-widest text-orange-500">Dead Letter Queue</h1>
                        </div>
                        <p className="text-xs uppercase tracking-widest text-white/40">
                            Orchestrate retries for failed telemetry, ingestion, and outreach payloads.
                        </p>
                    </div>
                    <button 
                        onClick={fetchDLQ}
                        className="px-4 py-2 border border-white/10 hover:border-white/30 text-[10px] font-black uppercase tracking-widest text-white/60 bg-black/40 rounded transition-colors"
                    >
                        {loading ? 'Refreshing...' : 'Refresh Queue'}
                    </button>
                </div>
            </header>

            <div className="glass-panel p-6 border-white/5 bg-black/40 min-h-[400px]">
                {loading && items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64">
                        <span className="text-white/40 text-xs uppercase tracking-widest animate-pulse">Loading Failed Signals...</span>
                    </div>
                ) : items.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 opacity-50">
                        <CheckCircle2 className="w-12 h-12 text-emerald-500 mb-4" />
                        <p className="text-[10px] uppercase tracking-widest text-emerald-500/80">Queue is clean. All payloads processed successfully.</p>
                    </div>
                ) : (
                    <div className="space-y-4">
                        {items.map((item, i) => (
                            <motion.div 
                                initial={{ opacity: 0, x: -10 }}
                                animate={{ opacity: 1, x: 0 }}
                                transition={{ delay: i * 0.05 }}
                                key={item.id} 
                                className="flex flex-col md:flex-row md:items-center justify-between p-4 bg-white/5 rounded-lg border border-white/5 gap-4"
                            >
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 mb-2">
                                        <AlertOctagon className="w-4 h-4 text-orange-400" />
                                        <span className="text-xs font-black text-white">{item.error || 'Unknown Error'}</span>
                                        <span className="text-[10px] px-2 py-0.5 rounded bg-white/10 text-white/60 font-mono">
                                            {item.source_queue || 'unknown_queue'}
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-white/40 font-mono truncate">
                                        {item.raw_text?.substring(0, 100)}...
                                    </p>
                                    <div className="mt-2 text-[9px] uppercase tracking-widest text-white/30">
                                        Failed at: {new Date(item.created_at).toLocaleString()}
                                    </div>
                                </div>
                                <div className="flex-shrink-0">
                                    <button 
                                        onClick={() => handleRetry(item.id)}
                                        disabled={retryStatus[item.id] === 'retrying' || retryStatus[item.id] === 'success'}
                                        className={`flex items-center gap-2 px-4 py-2 text-[10px] font-black uppercase tracking-widest rounded transition-colors ${
                                            retryStatus[item.id] === 'success' 
                                            ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/50'
                                            : retryStatus[item.id] === 'error'
                                            ? 'bg-red-500/20 text-red-400 border border-red-500/50 hover:bg-red-500/30'
                                            : 'bg-white/5 hover:bg-white/10 text-white/80 border border-white/10'
                                        }`}
                                    >
                                        <RotateCcw className={`w-3 h-3 ${retryStatus[item.id] === 'retrying' ? 'animate-spin' : ''}`} />
                                        {retryStatus[item.id] === 'success' ? 'Re-queued' : retryStatus[item.id] === 'error' ? 'Failed' : 'Retry Payload'}
                                    </button>
                                </div>
                            </motion.div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}

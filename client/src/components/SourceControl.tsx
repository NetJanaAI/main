import React, { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Check, X, Shield, Activity } from 'lucide-react';

interface Source {
    source_id: string;
    is_enabled: boolean;
}

const SourceControl: React.FC = () => {
    const [sources, setSources] = useState<Source[]>([]);
    const [loading, setLoading] = useState(true);
    const [toggling, setToggling] = useState<string | null>(null);

    useEffect(() => {
        fetchSources();
    }, []);

    const fetchSources = async () => {
        try {
            const resp = await fetch('/api/sources');
            const data = await resp.json();
            setSources(data);
        } catch (e) {
            console.error('Failed to fetch sources', e);
        } finally {
            setLoading(false);
        }
    };

    const toggleSource = async (sourceId: string, currentState: boolean) => {
        setToggling(sourceId);
        try {
            const resp = await fetch('/api/sources/toggle', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ sourceId, enabled: !currentState })
            });
            if (resp.ok) {
                setSources(prev => prev.map(s => 
                    s.source_id === sourceId ? { ...s, is_enabled: !currentState } : s
                ));
            }
        } catch (e) {
            console.error('Toggle failed', e);
        } finally {
            setToggling(null);
        }
    };

    if (loading) return (
        <div className="p-4 space-y-2">
            {[1, 2, 3].map(i => (
                <div key={i} className="h-10 bg-slate-800/50 animate-pulse rounded border border-slate-700" />
            ))}
        </div>
    );

    return (
        <div className="p-4 bg-slate-900/50 border-t border-slate-800">
            <div className="flex items-center gap-2 mb-4">
                <Shield className="w-4 h-4 text-cyan-400" />
                <h3 className="text-xs font-bold uppercase tracking-widest text-slate-400">
                    Intelligence Matrix
                </h3>
            </div>

            <div className="space-y-2">
                {sources.map((source) => (
                    <motion.div
                        key={source.source_id}
                        initial={{ opacity: 0, x: -10 }}
                        animate={{ opacity: 1, x: 0 }}
                        className={`flex items-center justify-between p-2 rounded border transition-colors ${
                            source.is_enabled 
                            ? 'bg-slate-800/80 border-cyan-900/50' 
                            : 'bg-slate-950/40 border-slate-800 opacity-60'
                        }`}
                    >
                        <div className="flex items-center gap-3">
                            <div className={`w-2 h-2 rounded-full ${
                                source.is_enabled ? 'bg-cyan-400 shadow-[0_0_8px_#22d3ee]' : 'bg-slate-600'
                            }`} />
                            <span className="text-[11px] font-mono uppercase tracking-tighter text-slate-200">
                                {source.source_id}
                            </span>
                        </div>

                        <button
                            onClick={() => toggleSource(source.source_id, source.is_enabled)}
                            disabled={toggling === source.source_id}
                            className={`p-1 rounded transition-all ${
                                source.is_enabled 
                                ? 'text-cyan-400 hover:bg-cyan-400/10' 
                                : 'text-slate-500 hover:bg-slate-800'
                            }`}
                        >
                            {toggling === source.source_id ? (
                                <Activity className="w-4 h-4 animate-spin" />
                            ) : source.is_enabled ? (
                                <Check className="w-4 h-4" />
                            ) : (
                                <X className="w-4 h-4" />
                            )}
                        </button>
                    </motion.div>
                ))}
            </div>

            <div className="mt-4 pt-4 border-t border-slate-800/50">
                <div className="flex items-center justify-between text-[10px] font-mono text-slate-500 italic">
                    <span>Autonomous Routing</span>
                    <span className="text-cyan-900">ACTIVE</span>
                </div>
            </div>
        </div>
    );
};

export default SourceControl;

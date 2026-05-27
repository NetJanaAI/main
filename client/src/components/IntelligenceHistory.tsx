import React, { useEffect, useState, useCallback } from 'react';
import { BarChart2, RefreshCw, Globe, TrendingUp, DollarSign } from 'lucide-react';
import { api } from '../lib/api';

interface RegistrySignalResult {
    job_id: string;
    domain: string;
    friction_score: number;
    geo_country: string;
    estimated_roi: number;
    compliance_verified: boolean;
    timestamp: string;
    critic_analysis?: any;
}

export const IntelligenceHistory: React.FC = () => {
    const [results, setResults] = useState<RegistrySignalResult[]>([]);
    const [loading, setLoading] = useState(false);
    const [search, setSearch] = useState('');
    const [sortBy, setSortBy] = useState<'timestamp' | 'friction_score' | 'estimated_roi'>('timestamp');

    const fetchResults = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/results');
            const data = await res.json();
            setResults(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error('Failed to fetch results:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchResults(); }, [fetchResults]);

    const filtered = results
        .filter(r => r.domain?.toLowerCase().includes(search.toLowerCase()))
        .sort((a, b) => {
            if (sortBy === 'friction_score') return b.friction_score - a.friction_score;
            if (sortBy === 'estimated_roi') return b.estimated_roi - a.estimated_roi;
            return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
        });

    return (
        <div className="w-full space-y-8 animate-in fade-in duration-500">
            <div className="flex items-center gap-6 flex-wrap">
                <div className="flex items-center gap-3">
                    <BarChart2 className="w-4 h-4 text-primary" />
                    <h2 className="text-[10px] font-black text-primary uppercase tracking-[4px]">Intelligence Ingress Vault</h2>
                </div>
                <div className="flex-1 h-px bg-primary/10 min-w-[50px]" />
                <div className="flex items-center gap-4">
                    <div className="relative">
                        <input
                            type="text"
                            placeholder="Search nodes..."
                            value={search}
                            onChange={e => setSearch(e.target.value)}
                            className="bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white/70 text-[10px] uppercase font-black tracking-widest focus:outline-none focus:border-primary/40 w-48 transition-all"
                        />
                    </div>
                    <select
                        value={sortBy}
                        onChange={e => setSortBy(e.target.value as any)}
                        className="bg-black/40 border border-white/10 rounded-xl px-4 py-2.5 text-white/40 text-[10px] uppercase font-black tracking-widest focus:outline-none focus:border-primary/40 transition-all cursor-pointer"
                    >
                        <option value="timestamp">Chronological</option>
                        <option value="friction_score">Alpha Index</option>
                        <option value="estimated_roi">Valuation ROI</option>
                    </select>
                    <button
                        onClick={fetchResults}
                        className="p-3 glass-panel border-white/5 hover:border-primary/20 transition-all rounded-xl"
                        title="Sync Vault"
                    >
                        <RefreshCw className={`w-3.5 h-3.5 text-white/40 ${loading ? 'animate-spin text-primary' : ''}`} />
                    </button>
                </div>
            </div>

            {loading && !results.length ? (
                <div className="text-center py-20 text-white/20 animate-pulse font-sans italic text-lg">Synchronizing Sovereign Vault...</div>
            ) : !filtered.length ? (
                <div className="glass-panel py-20 border-dashed border-white/5 bg-primary/[0.01] flex flex-col items-center justify-center text-center">
                    <BarChart2 className="w-12 h-12 text-white/5 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-[3px] text-white/20">Vault Empty</p>
                    <p className="font-sans italic text-lg text-white/10 mt-2">No intelligence signatures recorded in this organization.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                    {filtered.map(result => (
                        <div key={result.job_id} className="glass-panel p-6 border-white/5 hover:border-primary/30 transition-all duration-500 group relative overflow-hidden">
                            <div className="absolute top-0 right-0 p-4 opacity-5 group-hover:opacity-10 transition-opacity">
                                <TrendingUp className="w-24 h-24 -mr-6 -mt-6" />
                            </div>
                            
                            <div className="relative z-10 space-y-6">
                                <div className="flex items-start justify-between">
                                    <div className="space-y-1">
                                        <div className="flex items-center gap-2">
                                            <Globe className="w-3.5 h-3.5 text-primary/60" />
                                            <span className="text-white font-sans italic text-lg tracking-tight">{result.domain}</span>
                                        </div>
                                        <div className="flex items-center gap-3 text-[8px] font-black uppercase tracking-widest text-white/20">
                                            <span>{result.geo_country}</span>
                                            <span className="w-1 h-1 bg-white/10 rounded-full" />
                                            <span>{new Date(result.timestamp).toLocaleDateString()}</span>
                                        </div>
                                    </div>
                                    <div className={`text-3xl font-black italic tracking-tighter ${result.friction_score >= 75 ? 'text-primary' : 'text-white/40'}`}>
                                        {result.friction_score}
                                    </div>
                                </div>

                                <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                                    <div
                                        className="h-full bg-primary transition-all duration-1000 shadow-[0_0_10px_rgba(0,255,202,0.3)]"
                                        style={{ width: `${result.friction_score}%` }}
                                    />
                                </div>

                                <div className="flex items-center justify-between text-[9px] font-black uppercase tracking-[2px]">
                                    <span className="text-white/30">Alpha Signal Index</span>
                                    <span className="text-primary flex items-center gap-2">
                                        <DollarSign className="w-3 h-3" />
                                        ₹{(result.estimated_roi / 100000).toFixed(1)}L ROI
                                    </span>
                                </div>


                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

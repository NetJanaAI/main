import React, { useState, useEffect } from 'react';
import { RefreshCcw, Sparkles, Globe, Clock, ChevronRight } from 'lucide-react';
import FreshnessBadge from './FreshnessBadge';
import { api } from '../lib/api';

interface Lead {
    id: string;
    domain: string;
    friction_score: number;
    geo_country: string;
    freshness_score: string;
    decay_status: 'Hot' | 'Warm' | 'Cold' | 'Dead';
    signal_captured_at: string;
    previous_decay_status: string;
}

const ReEngageQueue: React.FC<{ organizationId: string }> = ({ organizationId }) => {
    const [leads, setLeads] = useState<Lead[]>([]);
    const [loading, setLoading] = useState(true);
    const [region, setRegion] = useState('All');

    useEffect(() => {
        fetchLeads();
    }, [organizationId, region]);

    const fetchLeads = async () => {
        setLoading(true);
        try {
            const url = `/api/leads/re-engage-queue?organizationId=${organizationId}${region !== 'All' ? `&region=${region}` : ''}`;
            const res = await api.get(url);
            const data = await res.json();
            setLeads(data);
        } catch (e) {
            console.error(e);
        } finally {
            setLoading(false);
        }
    };

    const triggerReingest = async (domain: string) => {
        const url = domain.startsWith('http') ? domain : `https://${domain}`;
        await api.post('/api/scrape', { url });
        alert("Signal refresh queued for timing optimization.");
    };

    const generateOutreach = (id: string) => {
        window.location.href = `/app/signals?lead=${encodeURIComponent(id)}&tab=action`;
    };

    return (
        <div className="flex flex-col h-full bg-slate-950 text-slate-200">
            {/* Header */}
            <div className="flex items-center justify-between p-8 border-b border-slate-900 bg-slate-900/20">
                <div>
                    <h1 className="text-3xl font-extrabold text-white tracking-tight flex items-center gap-3">
                        <Clock className="text-orange-500 w-8 h-8" />
                        Re-engage Queue
                    </h1>
                    <p className="text-slate-500 text-sm mt-1 font-medium">Timing-critical conversion opportunities in India/UAE</p>
                </div>
                
                <div className="flex gap-4">
                    <div className="flex bg-slate-900 rounded-xl p-1 border border-slate-800">
                        {['All', 'India', 'UAE'].map(r => (
                            <button 
                                key={r}
                                onClick={() => setRegion(r)}
                                className={`px-4 py-1.5 rounded-lg text-xs font-bold transition-all ${region === r ? 'bg-slate-800 text-white shadow-lg' : 'text-slate-500 hover:text-slate-300'}`}
                            >
                                {r}
                            </button>
                        ))}
                    </div>
                    <button onClick={fetchLeads} className="p-2.5 bg-slate-900 hover:bg-slate-800 rounded-xl border border-slate-800 transition-colors">
                        <RefreshCcw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {/* Content Area */}
            <div className="p-8 overflow-y-auto">
                {loading ? (
                    <div className="flex flex-col items-center justify-center h-64 animate-pulse">
                        <div className="w-12 h-12 border-2 border-indigo-500/30 border-t-indigo-500 rounded-full animate-spin mb-4" />
                        <p className="text-slate-500 font-medium">Scanning for decay transitions...</p>
                    </div>
                ) : leads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-64 bg-slate-900/20 rounded-3xl border-2 border-dashed border-slate-900">
                        <Sparkles className="w-12 h-12 text-slate-800 mb-4" />
                        <p className="text-slate-500 font-medium text-lg">Your signal verity is high. No leads currently in decay.</p>
                    </div>
                ) : (
                    <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
                        {leads.map(lead => (
                            <div key={lead.id} className="group relative bg-slate-900/40 rounded-3xl border border-slate-900 hover:border-orange-500/30 transition-all p-6 hover:shadow-2xl hover:shadow-orange-500/5">
                                <div className="flex justify-between items-start mb-6">
                                    <div>
                                        <h3 className="text-xl font-bold text-white group-hover:text-orange-400 transition-colors">{lead.domain}</h3>
                                        <div className="flex items-center gap-3 mt-2">
                                            <span className="flex items-center gap-1 text-[10px] font-bold text-slate-500 uppercase tracking-widest bg-slate-950 px-2 py-0.5 rounded-lg border border-slate-800">
                                                <Globe className="w-3 h-3" /> {lead.geo_country || 'Unknown'}
                                            </span>
                                            <div className="h-1 w-1 bg-slate-700 rounded-full" />
                                            <FreshnessBadge 
                                                status={lead.decay_status} 
                                                freshnessPercent={parseInt(lead.freshness_score)} 
                                                capturedAt={lead.signal_captured_at} 
                                                nextReview={new Date(Date.now() + 7 * 86400000).toISOString()}
                                            />
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] font-bold text-slate-600 uppercase tracking-widest mb-1">Impact Score</div>
                                        <div className="text-2xl font-black text-slate-300">{lead.friction_score}</div>
                                    </div>
                                </div>

                                <div className="bg-slate-950/50 rounded-2xl p-4 mb-6 border border-slate-900/50">
                                    <p className="text-slate-400 text-xs leading-relaxed">
                                        Signal captured <span className="text-white font-medium">{Math.floor((Date.now() - new Date(lead.signal_captured_at).getTime()) / (1000*60*60*24))} days ago</span>. 
                                        {lead.previous_decay_status === 'Warm' && <span className="text-orange-400/80 italic ml-1 font-medium">! Status just transitioned from Warm.</span>}
                                    </p>
                                </div>

                                <div className="grid grid-cols-2 gap-3">
                                    <button onClick={() => triggerReingest(lead.domain)} className="flex items-center justify-center gap-2 py-2.5 bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold rounded-xl transition-all">
                                        <RefreshCcw className="w-3 h-3" /> Refresh Signal
                                    </button>
                                    <button onClick={() => generateOutreach(lead.id)} className="flex items-center justify-center gap-2 py-2.5 bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-bold rounded-xl transition-all shadow-lg shadow-indigo-600/20">
                                        <Sparkles className="w-3 h-3" /> Take Action <ChevronRight className="w-3 h-3" />
                                    </button>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReEngageQueue;

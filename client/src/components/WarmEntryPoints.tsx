import React, { useState } from 'react';
import { ShieldCheck, Newspaper, Calendar, Mic, ExternalLink, RefreshCw, Zap } from 'lucide-react';

interface TradeBody {
    name: string;
    url: string;
    membershipType: string;
    relevanceScore: number;
}

interface Publication {
    name: string;
    url: string;
    mentionCount: number;
    lastMention: string;
}

interface Event {
    name: string;
    year: number;
    role: string;
}

interface Podcast {
    name: string;
    url: string;
    episodeCount: number;
}

interface InfluenceMap {
    tradeBodies: TradeBody[];
    publications: Publication[];
    events: Event[];
    podcasts: Podcast[];
    region: string;
    enrichedAt: string;
}

const WarmEntryPoints: React.FC<{ leadId: string; data: InfluenceMap; onReEnrich: () => void }> = ({ data, onReEnrich }) => {
    const [selectedhooks, setSelectedHooks] = useState<string[]>([]);

    const toggleHook = (hook: string) => {
        if (selectedhooks.includes(hook)) {
            setSelectedHooks(selectedhooks.filter(h => h !== hook));
        } else {
            setSelectedHooks([...selectedhooks, hook]);
        }
    };

    return (
        <div className="space-y-6">
            <div className="flex justify-between items-center bg-slate-900/20 p-4 rounded-2xl border border-slate-800">
                <div className="flex items-center gap-3">
                    <Zap className="text-yellow-500 w-5 h-5" />
                    <div>
                        <p className="text-xs font-bold text-white uppercase tracking-wider">Enrichment Status</p>
                        <p className="text-[10px] text-slate-500 font-medium">Last updated {new Date(data.enrichedAt).toLocaleString()} ({data.region})</p>
                    </div>
                </div>
                <button onClick={onReEnrich} className="flex items-center gap-2 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-white text-[10px] font-bold rounded-lg transition-colors border border-slate-700">
                    <RefreshCw className="w-3 h-3" /> Re-enrich Lead
                </button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Trade Bodies */}
                <div className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800 hover:border-rose-500/20 transition-colors">
                    <h3 className="flex items-center gap-2 text-[10px] font-black text-rose-500 uppercase tracking-widest mb-4">
                        <ShieldCheck className="w-4 h-4" /> Trade Bodies
                    </h3>
                    <div className="space-y-3">
                        {data.tradeBodies.map((tb, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-slate-950/50 rounded-xl border border-slate-900">
                                <div>
                                    <p className="text-[11px] font-bold text-white flex items-center gap-2">
                                        {tb.name} <a href={tb.url} target="_blank" rel="noreferrer"><ExternalLink className="w-3 h-3 text-slate-600 hover:text-rose-400" /></a>
                                    </p>
                                    <p className="text-[9px] text-slate-500 mt-0.5">{tb.membershipType} member</p>
                                </div>
                                <div className="flex items-center gap-3">
                                    <div className="w-10 h-1 bg-slate-800 rounded-full overflow-hidden">
                                        <div className="h-full bg-rose-500" style={{ width: `${tb.relevanceScore}%` }} />
                                    </div>
                                    <input 
                                        type="checkbox" 
                                        className="w-3.5 h-3.5 rounded bg-slate-800 border-none ring-0 checked:bg-rose-500" 
                                        onChange={() => toggleHook(tb.name)}
                                    />
                                </div>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Publications */}
                <div className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800 hover:border-amber-500/20 transition-colors">
                    <h3 className="flex items-center gap-2 text-[10px] font-black text-amber-500 uppercase tracking-widest mb-4">
                        <Newspaper className="w-4 h-4" /> Publications
                    </h3>
                    <div className="space-y-3">
                        {data.publications.map((p, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-slate-950/50 rounded-xl border border-slate-900">
                                <div>
                                    <p className="text-[11px] font-bold text-white">{p.name}</p>
                                    <p className="text-[9px] text-slate-500 mt-0.5">{p.mentionCount} mentions · Last: {new Date(p.lastMention).toLocaleDateString()}</p>
                                </div>
                                <input 
                                    type="checkbox" 
                                    className="w-3.5 h-3.5 rounded bg-slate-800 border-none ring-0 checked:bg-amber-500" 
                                    onChange={() => toggleHook(p.name)}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Events */}
                <div className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800 hover:border-emerald-500/20 transition-colors">
                    <h3 className="flex items-center gap-2 text-[10px] font-black text-emerald-500 uppercase tracking-widest mb-4">
                        <Calendar className="w-4 h-4" /> Events
                    </h3>
                    <div className="space-y-3">
                        {data.events.map((e, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-slate-950/50 rounded-xl border border-slate-900">
                                <div>
                                    <p className="text-[11px] font-bold text-white">{e.name} {e.year}</p>
                                    <p className="text-[9px] text-slate-500 mt-0.5">Role: {e.role}</p>
                                </div>
                                <input 
                                    type="checkbox" 
                                    className="w-3.5 h-3.5 rounded bg-slate-800 border-none ring-0 checked:bg-emerald-500" 
                                    onChange={() => toggleHook(e.name)}
                                />
                            </div>
                        ))}
                    </div>
                </div>

                {/* Podcasts */}
                <div className="bg-slate-900/40 p-5 rounded-2xl border border-slate-800 hover:border-indigo-500/20 transition-colors">
                    <h3 className="flex items-center gap-2 text-[10px] font-black text-indigo-500 uppercase tracking-widest mb-4">
                        <Mic className="w-4 h-4" /> Podcasts
                    </h3>
                    <div className="space-y-3">
                        {data.podcasts.map((p, i) => (
                            <div key={i} className="flex justify-between items-center p-3 bg-slate-950/50 rounded-xl border border-slate-900">
                                <div>
                                    <p className="text-[11px] font-bold text-white">{p.name}</p>
                                    <p className="text-[9px] text-slate-500 mt-0.5">{p.episodeCount} guest episodes</p>
                                </div>
                                <input 
                                    type="checkbox" 
                                    className="w-3.5 h-3.5 rounded bg-slate-800 border-none ring-0 checked:bg-indigo-500" 
                                    onChange={() => toggleHook(p.name)}
                                />
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <div className="p-4 bg-indigo-500/10 rounded-2xl border border-indigo-500/20">
                <p className="text-[10px] text-indigo-400 font-medium leading-relaxed">
                    <Zap className="inline-block w-3 h-3 mr-1 mb-0.5" />
                    Selected hooks will be injected into the <span className="text-white font-bold">Take Action</span> prompt to maximize cold outreach verity. 
                    NetJana's proprietary India/UAE source network provides a {Math.round(selectedhooks.length * 15.4)}% boost in estimated conversion verity.
                </p>
            </div>
        </div>
    );
};

export default WarmEntryPoints;

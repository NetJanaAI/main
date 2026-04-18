import React, { useState, useEffect } from 'react';
import { Server, Globe, ShieldCheck, TrendingUp, Zap, Download, RefreshCw } from 'lucide-react';
import { LogicDialogue } from './LogicDialogue';
import type { ScrapeResult } from '../types';
import InfluenceRadar from './InfluenceRadar';
import WarmEntryPoints from './WarmEntryPoints';
import TakeActionPanel from './TakeActionPanel';
import { api } from '../lib/api';

interface ResultCardProps {
    data: ScrapeResult;
}

export const ResultCard: React.FC<ResultCardProps> = ({ data }) => {
    const [activeSubTab, setActiveSubTab] = useState<'signals' | 'influence' | 'action'>('signals');
    const [influenceData, setInfluenceData] = useState<any>(null);
    const [loadingInfluence, setLoadingInfluence] = useState(false);
    
    useEffect(() => {
        if (activeSubTab === 'influence' && !influenceData && data.jobId) {
            fetchInfluence();
        }
    }, [activeSubTab, data.jobId]);

    const fetchInfluence = async () => {
        setLoadingInfluence(true);
        try {
            const res = await api.get(`/api/lead/${data.jobId}/influence`);
            if (res.ok) {
                const json = await res.json();
                setInfluenceData(json);
            }
        } catch (e) {
            console.error('Failed to fetch influence data:', e);
        } finally {
            setLoadingInfluence(false);
        }
    };

    if (!data) return null;

    return (
        <div className="w-full mt-10 grid grid-cols-1 lg:grid-cols-3 gap-10 animate-in zoom-in slide-in-from-bottom-5 duration-1000">
            <div className="lg:col-span-3 flex gap-4 mb-4 border-b border-white/5">
                <button 
                    onClick={() => setActiveSubTab('signals')}
                    className={`pb-4 px-6 text-[10px] font-black uppercase tracking-[3px] transition-all ${activeSubTab === 'signals' ? 'text-primary border-b-2 border-primary' : 'text-white/20 hover:text-white/40'}`}
                >
                    Technical Signals
                </button>
                <button 
                    onClick={() => setActiveSubTab('influence')}
                    className={`pb-4 px-6 text-[10px] font-black uppercase tracking-[3px] transition-all ${activeSubTab === 'influence' ? 'text-primary border-b-2 border-primary' : 'text-white/20 hover:text-white/40'}`}
                >
                    Influence Mapping
                </button>
                <button 
                    onClick={() => setActiveSubTab('action')}
                    className={`pb-4 px-6 text-[10px] font-black uppercase tracking-[3px] transition-all ${activeSubTab === 'action' ? 'text-primary border-b-2 border-primary' : 'text-white/20 hover:text-white/40'}`}
                >
                    Take Action
                </button>
            </div>

            {activeSubTab === 'action' ? (
                <div className="lg:col-span-3">
                    <TakeActionPanel leadId={data.jobId!} organizationId="demo_standalone_org" />
                </div>
            ) : activeSubTab === 'signals' ? (
                <>
                    <div className="glass-panel p-10 relative overflow-hidden group border-primary/10 bg-gradient-to-br from-primary/10 via-transparent to-transparent">
                        <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-20 transition-all duration-700">
                            <TrendingUp className="w-32 h-32 text-primary" />
                        </div>
                        <div className="institution-badge mb-6 text-primary">Intelligence Output</div>
                        <h3 className="text-white/20 text-[9px] font-black uppercase tracking-[4px] mb-2">Alpha score (Composite)</h3>
                        <div className="flex items-baseline gap-4">
                            <span className="text-7xl font-serif italic tracking-tighter text-white drop-shadow-[0_0_15px_rgba(255,255,255,0.1)]">{(data as any).alphaScore || data.frictionScore || 0}</span>
                            <span className="text-white/20 text-[9px] font-black uppercase tracking-[3px]">Sovereign Indices</span>
                        </div>

                        {/* ML Feedback Loop */}
                        <div className="mt-8 pt-6 border-t border-white/5 flex items-center gap-4">
                            <span className="text-[9px] font-black uppercase tracking-widest text-white/30">Intelligence Alignment:</span>
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => api.patch(`/api/leads/${data.jobId}/feedback`, { status: 'converted' })}
                                    className="px-3 py-1.5 rounded-lg bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[9px] font-black uppercase tracking-widest hover:bg-emerald-500/20 transition-all"
                                >
                                    Accurate
                                </button>
                                <button 
                                    onClick={() => api.patch(`/api/leads/${data.jobId}/feedback`, { status: 'wrong' })}
                                    className="px-3 py-1.5 rounded-lg bg-orange-500/10 border border-orange-500/20 text-orange-400 text-[9px] font-black uppercase tracking-widest hover:bg-orange-500/20 transition-all"
                                >
                                    Wrong Intent
                                </button>
                                <button 
                                    onClick={() => api.patch(`/api/leads/${data.jobId}/feedback`, { status: 'wrong' })}
                                    className="px-3 py-1.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-[9px] font-black uppercase tracking-widest hover:bg-red-500/20 transition-all"
                                >
                                    False Positive
                                </button>
                            </div>
                        </div>
                    </div>

                    <div className="glass-panel p-10 flex items-center gap-8 border-white/5 bg-gradient-to-tr from-white/[0.02] to-transparent">
                        <div className="relative w-24 h-24 flex items-center justify-center">
                            <div className="absolute inset-0 rounded-3xl bg-primary/5 border border-primary/20 blur-sm" />
                            <div className="relative w-20 h-20 rounded-3xl bg-background border border-primary/20 flex items-center justify-center text-primary group-hover:scale-110 transition-transform">
                                <Globe className="w-10 h-10" />
                            </div>
                        </div>
                        <div>
                            <h3 className="text-white/20 text-[9px] font-black uppercase tracking-[4px] mb-1">Ingress Location</h3>
                            <p className="text-3xl font-serif italic tracking-tighter text-white">{data.geoCountry || 'GLOBAL'}</p>
                        </div>
                    </div>

                    <div className="lg:col-span-3 glass-panel p-10 border-white/5 bg-white/[0.01]">
                        {data.criticAnalysis?.ceoIcebreaker && (
                            <div className="mb-12 p-8 border-l-4 border-primary bg-gradient-to-r from-primary/10 to-transparent rounded-r-3xl animate-in fade-in slide-in-from-left duration-1000">
                                <div className="flex items-center gap-2 mb-3">
                                    <Zap className="w-3 h-3 text-primary animate-pulse" />
                                    <h4 className="text-[10px] font-black uppercase tracking-[4px] text-primary/60">CEO Icebreaker Intent</h4>
                                </div>
                                <p className="font-serif italic text-2xl text-white leading-tight">
                                    "{data.criticAnalysis.ceoIcebreaker}"
                                </p>
                            </div>
                        )}

                        <div className="flex items-center justify-between mb-10">
                            <div className="flex items-center gap-4 text-primary">
                                <Server className="w-6 h-6" />
                                <h3 className="text-xl font-serif italic tracking-tighter uppercase text-white">Adversarial Signal Extraction</h3>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 sm:grid-cols-3 gap-10">
                            <div>
                                <h4 className="text-[9px] font-black uppercase tracking-[4px] text-white/30 mb-4 flex items-center gap-2">
                                    <TrendingUp className="w-3 h-3 text-primary" /> Technical Debt
                                </h4>
                                <div className="space-y-3">
                                    {(data.criticAnalysis?.painPoints?.technicalDebt || []).map((signal: string, i: number) => (
                                        <div key={i} className="px-5 py-3 bg-white/[0.03] border border-white/5 rounded-xl flex items-center gap-3 group hover:border-primary/30 transition-all">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-all" />
                                            <span className="text-[9px] font-black uppercase tracking-[1px] text-white/60 group-hover:text-white uppercase">{signal}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-[9px] font-black uppercase tracking-[4px] text-white/30 mb-4 flex items-center gap-2">
                                    <Zap className="w-3 h-3 text-primary" /> Operational Bottlenecks
                                </h4>
                                <div className="space-y-3">
                                    {(data.criticAnalysis?.painPoints?.operationalBottlenecks || data.signals || []).map((signal: string, i: number) => (
                                        <div key={i} className="px-5 py-3 bg-white/[0.03] border border-white/5 rounded-xl flex items-center gap-3 group hover:border-primary/30 transition-all">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary/40 group-hover:bg-primary transition-all" />
                                            <span className="text-[9px] font-black uppercase tracking-[1px] text-white/60 group-hover:text-white uppercase">{signal}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div>
                                <h4 className="text-[9px] font-black uppercase tracking-[4px] text-primary mb-4 flex items-center gap-2">
                                    <ShieldCheck className="w-3 h-3 text-primary" /> Strategic Alpha
                                </h4>
                                <div className="space-y-3">
                                    {(data.criticAnalysis?.painPoints?.strategicAlpha || []).map((signal: string, i: number) => (
                                        <div key={i} className="px-5 py-3 bg-primary/5 border border-primary/20 rounded-xl flex items-center gap-3 group hover:border-primary/40 transition-all">
                                            <div className="w-1.5 h-1.5 rounded-full bg-primary group-hover:scale-125 transition-all" />
                                            <span className="text-[9px] font-black uppercase tracking-[1px] text-white group-hover:text-primary transition-colors uppercase">{signal}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            ) : (
                <div className="lg:col-span-3 grid grid-cols-1 lg:grid-cols-2 gap-10 animate-in fade-in duration-700">
                    {loadingInfluence ? (
                        <div className="lg:col-span-2 h-[400px] flex items-center justify-center">
                            <RefreshCw className="w-8 h-8 text-primary animate-spin" />
                        </div>
                    ) : influenceData ? (
                        <>
                            <div className="glass-panel p-10 border-primary/10 bg-primary/5">
                                <h3 className="text-white/40 text-[9px] font-black uppercase tracking-[4px] mb-8">Proprietary Influence Scape</h3>
                                <InfluenceRadar 
                                    scores={influenceData.scores} 
                                    overallScore={influenceData.overallScore} 
                                    alphaScore={influenceData.alphaScore} 
                                />
                            </div>
                            <div className="glass-panel p-10 border-white/5">
                                <WarmEntryPoints 
                                    leadId={data.jobId!} 
                                    data={influenceData.map} 
                                    onReEnrich={fetchInfluence} 
                                />
                            </div>
                        </>
                    ) : (
                        <div className="lg:col-span-2 h-[400px] flex flex-col items-center justify-center text-white/20">
                            <Zap className="w-12 h-12 mb-4" />
                            <p className="font-serif italic text-xl">No influence data identified for this ingress.</p>
                        </div>
                    )}
                </div>
            )}

            {data.screenshotPath && (
                <div className="lg:col-span-3 glass-panel p-8 border-white/5 bg-gradient-to-tr from-white/[0.02] to-transparent animate-in fade-in slide-in-from-bottom-5 duration-1000">
                    <h3 className="text-white/40 text-[9px] font-black uppercase tracking-[4px] mb-6 flex items-center gap-3">
                        <Globe className="w-4 h-4 text-primary" /> Visual Signal Extraction
                    </h3>
                    <div className="relative rounded-3xl overflow-hidden border border-white/10 group shadow-2xl">
                        <img 
                            src={data.screenshotPath} 
                            alt="Captured site UI" 
                            className="w-full object-cover max-h-[500px] object-top opacity-70 group-hover:opacity-100 transition-all duration-700 select-none pointer-events-none"
                        />
                        <div className="absolute inset-0 bg-gradient-to-t from-background/90 via-background/20 to-transparent pointer-events-none" />
                    </div>
                </div>
            )}

            <div className="lg:col-span-3">
                <LogicDialogue steps={data.criticAnalysis?.verity_steps || []} />
            </div>

            {data.jobId && (
                <div className="lg:col-span-3 mt-8 flex flex-col sm:flex-row justify-center gap-6 animate-in fade-in slide-in-from-bottom-10 duration-1000 delay-500">
                    <a 
                        href={`/api/results/report/${data.jobId}`} 
                        target="_blank" 
                        rel="noreferrer"
                        className="inline-flex items-center gap-3 px-8 py-4 bg-primary text-background focus:outline-none hover:scale-105 transition-all duration-300 shadow-[0_0_30px_rgba(255,255,255,0.15)] hover:shadow-[0_0_50px_rgba(255,255,255,0.3)] rounded-2xl group"
                    >
                        <Download className="w-5 h-5 group-hover:animate-bounce" />
                        <div className="text-left">
                            <span className="block text-sm font-black uppercase tracking-[3px]">Intelligence PDF</span>
                            <span className="block text-[8px] font-black uppercase tracking-[2px] opacity-60">Sovereign Format</span>
                        </div>
                    </a>
                </div>
            )}
        </div>
    );
};

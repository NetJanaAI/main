import { useEffect, useState } from 'react';
import type { LeadCard } from '../../types';
import { ShieldAlert, Zap, Factory, Timer, RadioReceiver, MapPin } from 'lucide-react';

export default function LiveFeed({ market }: { market: 'IN' | 'AE' }) {
    const [leads, setLeads] = useState<LeadCard[]>([]);

    useEffect(() => {
        const handleNewLead = (e: Event) => {
            const customEvent = e as CustomEvent<LeadCard>;
            setLeads((prev) => [customEvent.detail, ...prev].slice(0, 50)); // Keep last 50
        };

        window.addEventListener('new_lead_event', handleNewLead);
        return () => window.removeEventListener('new_lead_event', handleNewLead);
    }, []);

    const filteredLeads = leads.filter(l => l.geo_market === market);

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <h3 className="text-xl font-sans italic text-gray-200">
                    {market === 'IN' ? 'India' : 'UAE'} Signal Intelligence
                </h3>
                <span className="text-xs font-black uppercase tracking-widest text-[#00ffca]/50 flex items-center gap-2">
                    <RadioReceiver className="w-4 h-4" /> Stream Active
                </span>
            </div>

            <div className="space-y-4">
                {leads.length === 0 && (
                    <div className="h-64 flex flex-col items-center justify-center border border-dashed border-white/10 rounded-xl bg-white/[0.02]">
                        <RadioReceiver className="w-8 h-8 text-white/20 animate-pulse mb-4" />
                        <p className="text-xs font-black uppercase tracking-widest text-white/20">Awaiting Target Acquisition</p>
                    </div>
                )}

                {filteredLeads.map((lead) => (
                    <div key={lead.lead_id} className="relative p-6 rounded-xl border border-white/10 bg-[#061124] overflow-hidden shadow-2xl">
                        {/* Background Accent */}
                        <div className={`absolute top-0 right-0 w-64 h-64 opacity-20 blur-3xl rounded-full transform translate-x-1/2 -translate-y-1/2 ${lead.verity_tier === 'HIGH_VERITY' ? 'bg-[#00ffca]' : 'bg-blue-500'}`} />

                        <div className="relative z-10 flex flex-col md:flex-row gap-8">
                            {/* Left Column: Metadata */}
                            <div className="w-full md:w-1/3 space-y-4">
                                <div>
                                    <div className="flex items-center gap-2 mb-1">
                                        <Factory className="w-4 h-4 text-[#00ffca]" />
                                        <h4 className="font-bold text-lg leading-tight uppercase tracking-wide text-white">{lead.company_name}</h4>
                                    </div>
                                    <div className="flex items-center gap-2 text-xs text-white/50 font-medium">
                                        <MapPin className="w-3 h-3" /> {lead.geo_state} &bull; {lead.sector}
                                    </div>
                                </div>

                                <div className="flex flex-wrap gap-2">
                                    <span className="px-2 py-1 text-[10px] font-black uppercase tracking-widest bg-black/40 border border-white/10 rounded-md flex items-center gap-1 text-white/80">
                                        Source: {lead.source_id.toUpperCase()}
                                    </span>
                                    <span className={`px-2 py-1 text-[10px] font-black uppercase tracking-widest rounded-md border flex items-center gap-1 ${lead.verity_tier === 'HIGH_VERITY' ? 'bg-[#00ffca]/10 border-[#00ffca]/30 text-[#00ffca]' : 'bg-blue-500/10 border-blue-500/30 text-blue-400'
                                        }`}>
                                        {lead.verity_tier === 'HIGH_VERITY' ? <ShieldAlert className="w-3 h-3" /> : <Zap className="w-3 h-3" />}
                                        {lead.verity_tier.replace('_', ' ')}
                                    </span>
                                </div>

                                <div className="pt-2">
                                    <div className="text-[10px] font-black uppercase tracking-widest text-white/30 mb-1">Intent Score</div>
                                    <div className="flex items-end gap-2">
                                        <span className="text-3xl font-sans italic text-white leading-none">{(lead.intent_score * 100).toFixed(0)}</span>
                                        <span className="text-sm font-bold text-white/40 mb-1">/ 100</span>
                                    </div>
                                </div>
                            </div>

                            {/* Right Column: Intelligence */}
                            <div className="w-full md:w-2/3 flex flex-col gap-4">
                                <div className="bg-black/20 rounded-lg p-4 border border-white/5">
                                    <h5 className="text-[10px] font-black uppercase tracking-widest text-[#00ffca]/70 mb-2 flex items-center gap-2">
                                        <Zap className="w-3 h-3" /> Identified Need
                                    </h5>
                                    <p className="text-sm text-gray-300 leading-relaxed font-medium">{lead.card_what_they_need}</p>
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-black/20 rounded-lg p-4 border border-white/5">
                                        <h5 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2 flex items-center gap-2">
                                            <Timer className="w-3 h-3" /> Why Now
                                        </h5>
                                        <p className="text-xs text-gray-400 leading-relaxed">{lead.card_why_now}</p>
                                    </div>

                                    <div className="bg-black/20 rounded-lg p-4 border border-white/5">
                                        <h5 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-2 flex items-center gap-2">
                                            <ShieldAlert className="w-3 h-3" /> Recommended Action
                                        </h5>
                                        <p className="text-xs text-gray-400 leading-relaxed">{lead.card_do_this}</p>
                                    </div>
                                </div>
                            </div>

                        </div>
                    </div>
                ))}
            </div>
        </div>
    );
}

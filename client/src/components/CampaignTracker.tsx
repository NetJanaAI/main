import React, { useEffect, useState, useCallback } from 'react';
import { Layers, RefreshCw, ArrowRight } from 'lucide-react';
import { api } from '../lib/api';
import ROIExportPanel from './ROIExportPanel';

type CampaignState = 'DISCOVERED' | 'CAPSULE_SENT' | 'ACKNOWLEDGED' | 'CONVERTED' | 'DORMANT';

interface Campaign {
    id: string;
    domain: string;
    state: CampaignState;
    capsule_id?: string;
    notes?: string;
    friction_score?: number;
    estimated_roi?: number;
    geo_country?: string;
    updated_at: string;
}

const STATES: { key: CampaignState; label: string; color: string; bg: string }[] = [
    { key: 'DISCOVERED', label: 'Discovered', color: 'text-blue-400', bg: 'border-blue-500/20 bg-blue-950/10' },
    { key: 'CAPSULE_SENT', label: 'Capsule Sent', color: 'text-purple-400', bg: 'border-purple-500/20 bg-purple-950/10' },
    { key: 'ACKNOWLEDGED', label: 'Acknowledged', color: 'text-yellow-400', bg: 'border-yellow-500/20 bg-yellow-950/10' },
    { key: 'CONVERTED', label: 'Converted ✓', color: 'text-emerald-400', bg: 'border-emerald-500/20 bg-emerald-950/10' },
];

const STATE_TRANSITIONS: Record<CampaignState, CampaignState | null> = {
    DISCOVERED: 'CAPSULE_SENT',
    CAPSULE_SENT: 'ACKNOWLEDGED',
    ACKNOWLEDGED: 'CONVERTED',
    CONVERTED: null,
    DORMANT: 'DISCOVERED',
};

export const CampaignTracker: React.FC = () => {
    const [campaigns, setCampaigns] = useState<Campaign[]>([]);
    const [loading, setLoading] = useState(false);
    const [showROI, setShowROI] = useState(false);

    const fetchCampaigns = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/campaigns');
            if (res.ok) {
                const data = await res.json();
                setCampaigns(Array.isArray(data) ? data : []);
            }
        } catch (e) {
            console.error('Failed to fetch campaigns:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { 
        fetchCampaigns(); 
    }, [fetchCampaigns]);

    const advanceState = async (campaign: Campaign) => {
        const nextState = STATE_TRANSITIONS[campaign.state];
        if (!nextState) return;

        try {
            const res = await api.post(`/api/campaigns/${encodeURIComponent(campaign.domain)}/advance`, { state: nextState });
            if (res.ok) {
                await fetchCampaigns();
            }
        } catch (e) {
            console.error('Failed to advance campaign:', e);
        }
    };

    const markDormant = async (campaign: Campaign) => {
        try {
            const res = await api.post(`/api/campaigns/${encodeURIComponent(campaign.domain)}/advance`, { state: 'DORMANT' });
            if (res.ok) {
                await fetchCampaigns();
            }
        } catch (e) {
            console.error('Failed to mark dormant:', e);
        }
    };

    return (
        <div className="w-full space-y-10 animate-in fade-in duration-500">
            <div className="flex items-center gap-4">
                <Layers className="w-5 h-5 text-primary" />
                <h2 className="text-lg font-black text-white uppercase tracking-widest">Campaign Pipeline</h2>
                <div className="ml-auto flex gap-4">
                    <button 
                        onClick={() => setShowROI(!showROI)}
                        className={`px-4 py-2 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all border ${showROI ? 'bg-primary text-background border-primary' : 'bg-white/5 text-white/60 border-white/10 hover:bg-white/10'}`}
                    >
                        {showROI ? 'Close ROI Engine' : 'Campaign ROI Engine'}
                    </button>
                    <button onClick={fetchCampaigns} className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors border border-white/10">
                        <RefreshCw className={`w-4 h-4 text-white/60 ${loading ? 'animate-spin' : ''}`} />
                    </button>
                </div>
            </div>

            {showROI && campaigns.length > 0 && (
                <div className="animate-in slide-in-from-top-4 duration-500">
                    <ROIExportPanel campaignId={campaigns[0].id} organizationId="demo_standalone_org" />
                </div>
            )}

            {!campaigns.length ? (
                <div className="text-center py-20 text-white/30 whitespace-pre-wrap">No active campaigns discovered yet.
                {"\n"}Intelligence ingress required to prime the pipeline.</div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
                    {STATES.map(({ key, label, color, bg }) => {
                        const col = campaigns.filter(c => c.state === key);
                        return (
                            <div key={key} className={`rounded-xl border p-4 space-y-3 ${bg}`}>
                                <div className="flex items-center justify-between">
                                    <span className={`text-xs font-black uppercase tracking-widest ${color}`}>{label}</span>
                                    <span className="text-white/30 text-xs">{col.length}</span>
                                </div>
                                <div className="space-y-2 min-h-[100px]">
                                    {col.map(campaign => (
                                        <div key={campaign.id} className="bg-slate-950/40 rounded-lg p-3 border border-white/5 space-y-3 group hover:border-white/20 transition-all">
                                            <div className="font-bold text-white text-xs truncate">{campaign.domain}</div>
                                            {campaign.friction_score !== undefined && (
                                                <div className="flex items-center gap-2 text-[10px] text-white/40">
                                                    <span>α: <span className={color}>{campaign.friction_score}</span></span>
                                                    {campaign.geo_country && <span>· {campaign.geo_country}</span>}
                                                </div>
                                            )}
                                            <div className="flex gap-2 pt-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                {STATE_TRANSITIONS[campaign.state] && (
                                                    <button
                                                        onClick={() => advanceState(campaign)}
                                                        className={`flex items-center gap-1 text-[9px] px-2 py-1 rounded border ${color} border-current hover:bg-white/5 transition-colors font-black uppercase tracking-tighter`}
                                                    >
                                                        <ArrowRight className="w-3 h-3" />
                                                        {STATE_TRANSITIONS[campaign.state]?.replace(/_/g, ' ')}
                                                    </button>
                                                )}
                                                {campaign.state !== 'DORMANT' && campaign.state !== 'CONVERTED' && (
                                                    <button
                                                        onClick={() => markDormant(campaign)}
                                                        className="text-[9px] px-2 py-1 rounded border border-white/10 text-white/30 hover:text-white/60 hover:bg-white/5 transition-colors font-black uppercase tracking-tighter"
                                                    >
                                                        Dormant
                                                    </button>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

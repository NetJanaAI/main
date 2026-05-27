import React, { useEffect, useState, useCallback } from 'react';
import { Send, CheckCircle, XCircle, Clock, RefreshCw, Calendar } from 'lucide-react';
import { api } from '../lib/api';

interface Capsule {
    id: string;
    job_id: string;
    domain: string;
    status: 'pending' | 'ready' | 'delivered' | 'failed';
    delivered_at: string | null;
    created_at: string;
    friction_score?: string;
    icebreaker?: string;
}

interface ScheduleModalProps {
    domain: string;
    onClose: () => void;
}

const statusConfig = {
    pending: { icon: Clock, color: 'text-yellow-400', label: 'Pending' },
    ready: { icon: CheckCircle, color: 'text-blue-400', label: 'Ready' },
    delivered: { icon: CheckCircle, color: 'text-emerald-400', label: 'Delivered' },
    failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
};

const CRON_PRESETS = [
    { label: 'Daily at 9am', value: '0 9 * * *' },
    { label: 'Weekly Monday', value: '0 9 * * 1' },
    { label: 'Every 12 hours', value: '0 */12 * * *' },
    { label: 'Custom...', value: 'custom' }
];

const ScheduleModal: React.FC<ScheduleModalProps> = ({ domain, onClose }) => {
    const [preset, setPreset] = useState(CRON_PRESETS[0].value);
    const [custom, setCustom] = useState('');
    const [saving, setSaving] = useState(false);

    const save = async () => {
        setSaving(true);
        const cron = preset === 'custom' ? custom : preset;
        await api.post('/api/schedules', { domain, cron_expression: cron, use_online_ai: true, spider_mode: false });
        setSaving(false);
        onClose();
    };

    return (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50">
            <div className="glass-panel p-8 w-full max-w-md space-y-5 border border-primary/20">
                <h3 className="text-white font-black text-lg">Schedule Re-ingest</h3>
                <p className="text-white/50 text-sm">Domain: <span className="text-primary font-mono">{domain}</span></p>
                <div className="space-y-3">
                    {CRON_PRESETS.map(p => (
                        <label key={p.value} className="flex items-center gap-3 cursor-pointer group">
                            <div className={`w-4 h-4 rounded-full border-2 flex items-center justify-center transition-colors ${preset === p.value ? 'border-primary bg-primary/20' : 'border-white/20 group-hover:border-white/40'}`}>
                                {preset === p.value && <div className="w-2 h-2 rounded-full bg-primary" />}
                            </div>
                            <input type="radio" value={p.value} checked={preset === p.value} onChange={e => setPreset(e.target.value)} className="sr-only" />
                            <span className="text-white/70 text-sm">{p.label}</span>
                        </label>
                    ))}
                </div>
                {preset === 'custom' && (
                    <input
                        type="text"
                        value={custom}
                        onChange={e => setCustom(e.target.value)}
                        placeholder="e.g. 0 9 * * 1-5"
                        className="w-full bg-white/5 border border-white/10 rounded-lg px-4 py-2 text-white font-mono text-sm"
                    />
                )}
                <div className="flex gap-3">
                    <button onClick={onClose} className="flex-1 py-2 rounded-lg border border-white/10 text-white/50 hover:bg-white/5 transition-colors text-sm">Cancel</button>
                    <button onClick={save} disabled={saving} className="flex-1 py-2 rounded-lg bg-primary text-black font-bold hover:bg-primary/80 transition-colors text-sm">
                        {saving ? 'Saving...' : 'Schedule'}
                    </button>
                </div>
            </div>
        </div>
    );
};

export const CampaignFeed: React.FC = () => {
    const [capsules, setCapsules] = useState<Capsule[]>([]);
    const [loading, setLoading] = useState(false);
    const [scheduleDomain, setScheduleDomain] = useState<string | null>(null);

    const fetchCapsules = useCallback(async () => {
        setLoading(true);
        try {
            const res = await api.get('/api/capsules');
            const data = await res.json();
            setCapsules(Array.isArray(data) ? data : []);
        } catch (e) {
            console.error('Failed to fetch capsules:', e);
        } finally {
            setLoading(false);
        }
    }, []);

    useEffect(() => { fetchCapsules(); }, [fetchCapsules]);

    return (
        <div className="w-full space-y-8 animate-in fade-in duration-500">
            {scheduleDomain && <ScheduleModal domain={scheduleDomain} onClose={() => { setScheduleDomain(null); fetchCapsules(); }} />}

            <div className="flex items-center gap-4">
                <Send className="w-4 h-4 text-primary" />
                <h2 className="text-[10px] font-black text-primary uppercase tracking-[4px]">NetJana.AI Intelligence Feed</h2>
                <div className="h-px flex-1 bg-primary/10 ml-4" />
                <button onClick={fetchCapsules} className="p-3 glass-panel border-white/5 hover:border-primary/20 transition-all rounded-xl">
                    <RefreshCw className={`w-3.5 h-3.5 text-white/40 group-hover:text-primary ${loading ? 'animate-spin text-primary' : ''}`} />
                </button>
            </div>

            {!capsules.length && !loading ? (
                <div className="glass-panel py-20 border-dashed border-white/5 bg-primary/[0.01] flex flex-col items-center justify-center text-center">
                    <Send className="w-12 h-12 text-white/5 mb-4" />
                    <p className="text-[10px] font-black uppercase tracking-[3px] text-white/20">Awaiting Ingress...</p>
                    <p className="font-sans italic text-lg text-white/10 mt-2">No intelligence capsules generated in this quadrant.</p>
                </div>
            ) : (
                <div className="space-y-4">
                    {capsules.map(cap => {
                        const cfg = statusConfig[cap.status] || statusConfig.pending;
                        const Icon = cfg.icon;
                        return (
                            <div key={cap.id} className="glass-panel p-6 border-white/5 hover:border-primary/20 transition-all flex items-center gap-6 group">
                                <div className={`w-12 h-12 rounded-xl glass-panel flex items-center justify-center border-white/5 group-hover:border-primary/20 transition-all ${cfg.color}`}>
                                    <Icon className="w-5 h-5 flex-shrink-0" />
                                </div>
                                <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-4 mb-1">
                                        <span className="text-white font-sans italic text-lg">{cap.domain}</span>
                                        <span className={`text-[9px] font-black uppercase tracking-[2px] px-2 py-0.5 rounded-full border border-current bg-current/5 ${cfg.color}`}>
                                            {cfg.label}
                                        </span>
                                    </div>
                                    {cap.icebreaker && (
                                        <p className="text-white/40 text-[10px] uppercase font-bold tracking-widest truncate italic">
                                            "{cap.icebreaker}"
                                        </p>
                                    )}
                                </div>
                                <div className="text-right flex flex-col items-end gap-1">
                                    {cap.friction_score && (
                                        <div className="text-primary text-xs font-black italic tracking-tighter">
                                            ALPHA_SCORE: {cap.friction_score}
                                        </div>
                                    )}
                                    <div className="text-[8px] font-bold uppercase tracking-widest text-white/20">
                                        Ingressed: {new Date(cap.created_at).toLocaleString()}
                                    </div>
                                    {cap.delivered_at && (
                                        <div className="text-emerald-500/60 text-[8px] font-black uppercase tracking-widest">
                                            Delivered: {new Date(cap.delivered_at).toLocaleTimeString()}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={() => setScheduleDomain(cap.domain)}
                                    className="p-3 glass-panel border-white/5 hover:border-primary/40 text-white/20 hover:text-primary transition-all rounded-xl"
                                    title="Schedule Re-ingest"
                                >
                                    <Calendar className="w-4 h-4" />
                                </button>
                            </div>
                        );
                    })}
                </div>
            )}
        </div>
    );
};

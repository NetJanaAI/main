import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { Copy, Link, Mail, Linkedin, Phone, Sparkles, RefreshCcw } from 'lucide-react';
import { ApiError, api } from '../lib/api';

interface OutreachAsset {
    coldEmail: { subject: string; body: string };
    linkedinNote: string;
    callScript: { opener: string; frictionHook: string; cta: string };
    qualityScore: number;
    metadata: {
        tone: string;
        region: string;
        isRewritten: boolean;
        criticIssues: string[];
    };
}

const TakeActionPanel: React.FC<{ leadId: string; organizationId: string }> = ({ leadId, organizationId }) => {
    const [assets, setAssets] = useState<OutreachAsset | null>(null);
    const [loading, setLoading] = useState(false);
    const [tone, setTone] = useState('direct');
    const [activeTab, setActiveTab] = useState<'email' | 'linkedin' | 'call'>('email');
    const [copied, setCopied] = useState(false);

    useEffect(() => {
        const socket = io({ query: { organizationId } });
        
        socket.on('lead:outreach_ready', (data) => {
            if (data.leadId === leadId) {
                setAssets(data.payload);
                setLoading(false);
            }
        });

        return () => { socket.disconnect(); };
    }, [leadId, organizationId]);

    const generateOutreach = async () => {
        setLoading(true);
        try {
            await api.post(`/api/outreach/${leadId}/generate-outreach?tone=${tone}`, {});
            // Success depends on socket event 'lead:outreach_ready'
            // But we add a safety timeout to prevent indefinite loading
            setTimeout(() => setLoading(false), 15000); 
        } catch (e) {
            if (e instanceof ApiError && e.status === 402) {
                alert("Freemium limit reached. Upgrade for more generations.");
            }
            setLoading(false);
        }
    };

    const copyToClipboard = (text: string) => {
        navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    const shareOutreach = async () => {
        const res = await api.post(`/api/share/${leadId}`, {});
        const data = await res.json();
        copyToClipboard(`${window.location.origin}${data.shareUrl}`);
        alert("Public share link copied to clipboard!");
    };

    if (!assets && !loading) {
        return (
            <div className="flex flex-col items-center justify-center p-12 bg-slate-900/40 rounded-3xl border border-slate-800/50">
                <Sparkles className="w-12 h-12 text-slate-700 mb-4" />
                <h3 className="text-xl font-bold text-white mb-2">High-Verity Outreach</h3>
                <p className="text-slate-400 text-center max-w-sm mb-6">Generate regional-specific assets targeting detected friction signals in the India/UAE corridor.</p>
                
                <div className="flex gap-4 mb-6">
                    {['formal', 'direct', 'consultative'].map(t => (
                        <button 
                            key={t}
                            onClick={() => setTone(t)}
                            className={`px-4 py-2 rounded-xl text-sm capitalize transition-all ${tone === t ? 'bg-indigo-600 text-white shadow-lg shadow-indigo-500/20' : 'bg-slate-800 text-slate-400 hover:bg-slate-750'}`}
                        >
                            {t}
                        </button>
                    ))}
                </div>

                <button 
                    onClick={generateOutreach}
                    className="flex items-center gap-2 py-3 px-8 bg-indigo-600 hover:bg-indigo-500 text-white font-bold rounded-2xl transition-all active:scale-95"
                >
                    <Sparkles className="w-4 h-4" />
                    Engage Adversarial Loop
                </button>
            </div>
        );
    }

    if (loading) {
        return (
            <div className="flex flex-col items-center justify-center p-20">
                <RefreshCcw className="w-12 h-12 text-indigo-500 animate-spin mb-4" />
                <p className="text-slate-400 font-medium tracking-wide text-xs uppercase">Processing Adversarial Rewrite Clusters...</p>
                <p className="text-slate-500 text-[10px] mt-2 italic">Injecting regional verity signals</p>
            </div>
        );
    }

    return (
        <div className="bg-slate-900/60 rounded-3xl border border-slate-800 overflow-hidden shadow-2xl">
            {/* Header */}
            <div className="flex items-center justify-between p-6 bg-slate-800/30 border-b border-slate-800">
                <div className="flex items-center gap-4">
                    <div className={`px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-widest ${assets!.qualityScore > 80 ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' : 'bg-orange-500/10 text-orange-400 border border-orange-500/20'}`}>
                        Quality: {assets!.qualityScore}/100
                    </div>
                    {assets!.metadata.isRewritten && <span className="text-[10px] text-indigo-400 font-medium italic">Adversarial Rewrite Applied</span>}
                </div>
                <div className="flex gap-2">
                    <button onClick={generateOutreach} className="p-2 text-slate-400 hover:text-white transition-colors" title="Regenerate">
                        <RefreshCcw className="w-4 h-4" />
                    </button>
                    <button onClick={shareOutreach} className="p-2 text-slate-400 hover:text-white transition-colors" title="Share Outreach">
                        <Link className="w-4 h-4" />
                    </button>
                </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-slate-800">
                <button onClick={() => setActiveTab('email')} className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'email' ? 'text-white border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-slate-500 hover:text-slate-300'}`}>
                    <Mail className="w-4 h-4" /> Cold Email
                </button>
                <button onClick={() => setActiveTab('linkedin')} className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'linkedin' ? 'text-white border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-slate-500 hover:text-slate-300'}`}>
                    <Linkedin className="w-4 h-4" /> LinkedIn
                </button>
                <button onClick={() => setActiveTab('call')} className={`flex-1 flex items-center justify-center gap-2 py-4 text-xs font-bold uppercase tracking-wider transition-all ${activeTab === 'call' ? 'text-white border-b-2 border-indigo-500 bg-indigo-500/5' : 'text-slate-500 hover:text-slate-300'}`}>
                    <Phone className="w-4 h-4" /> Call Script
                </button>
            </div>

            {/* Content Area */}
            <div className="p-8">
                {activeTab === 'email' && (
                    <div className="space-y-6">
                        <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase mb-2 block">Subject Line</label>
                            <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800 text-slate-200 font-medium">
                                {assets!.coldEmail.subject}
                            </div>
                        </div>
                        <div>
                            <label className="text-[10px] text-slate-500 font-bold uppercase mb-2 block">Email Body</label>
                            <div className="p-6 bg-slate-950/50 rounded-xl border border-slate-800 text-slate-300 whitespace-pre-wrap leading-relaxed text-sm h-64 overflow-y-auto">
                                {assets!.coldEmail.body}
                            </div>
                        </div>
                        <button onClick={() => copyToClipboard(assets!.coldEmail.body)} className="w-full py-4 bg-slate-800 hover:bg-slate-750 text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all">
                            <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Email Body'}
                        </button>
                    </div>
                )}

                {activeTab === 'linkedin' && (
                    <div className="space-y-6">
                        <div className="p-6 bg-slate-950/50 rounded-xl border border-slate-800 text-slate-300 leading-relaxed italic">
                            "{assets!.linkedinNote}"
                        </div>
                        <div className="text-right text-[10px] text-slate-500">
                            {assets!.linkedinNote.length} / 300 chars
                        </div>
                        <button onClick={() => copyToClipboard(assets!.linkedinNote)} className="w-full py-4 bg-slate-800 hover:bg-slate-750 text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all">
                            <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Note'}
                        </button>
                    </div>
                )}

                {activeTab === 'call' && (
                    <div className="space-y-4">
                        <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                            <label className="text-[10px] text-emerald-500/70 font-bold uppercase mb-1 block">The Opener</label>
                            <p className="text-slate-300 text-sm">"{assets!.callScript.opener}"</p>
                        </div>
                        <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                            <label className="text-[10px] text-indigo-500/70 font-bold uppercase mb-1 block">The Friction Hook</label>
                            <p className="text-slate-300 text-sm">"{assets!.callScript.frictionHook}"</p>
                        </div>
                        <div className="p-4 bg-slate-950/50 rounded-xl border border-slate-800">
                            <label className="text-[10px] text-rose-500/70 font-bold uppercase mb-1 block">The CTA</label>
                            <p className="text-slate-300 text-sm">"{assets!.callScript.cta}"</p>
                        </div>
                        <button onClick={() => copyToClipboard(`${assets!.callScript.opener} ${assets!.callScript.frictionHook} ${assets!.callScript.cta}`)} className="w-full py-4 bg-slate-800 hover:bg-slate-750 text-white font-bold rounded-2xl flex items-center justify-center gap-2 transition-all">
                            <Copy className="w-4 h-4" /> {copied ? 'Copied!' : 'Copy Full Script'}
                        </button>
                    </div>
                )}
            </div>

            {/* Footer */}
            <div className="px-8 py-4 bg-slate-800/10 border-t border-slate-800 flex justify-between items-center">
                <div className="text-[9px] text-slate-500 uppercase tracking-widest font-bold">
                    Region: {assets!.metadata.region} · Tone: {assets!.metadata.tone}
                </div>
                {assets!.metadata.criticIssues.length > 0 && (
                    <div className="text-[9px] text-orange-500 font-medium" title={assets!.metadata.criticIssues.join('\n')}>
                        {assets!.metadata.criticIssues.length} Quality Improvements Detected
                    </div>
                )}
            </div>
        </div>
    );
};

export default TakeActionPanel;

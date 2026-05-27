import React, { useState } from 'react';
import { FileDown, Share2, CheckCircle2, ShieldAlert, Download, ExternalLink, RefreshCw } from 'lucide-react';
import { api } from '../lib/api';

const ROIExportPanel: React.FC<{ campaignId: string; organizationId: string }> = ({ campaignId, organizationId }) => {
    const [avgDealSize, setAvgDealSize] = useState<number>(5000);
    const [exporting, setExporting] = useState(false);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const [lastExport, setLastExport] = useState<string | null>(null);

    const handleDownload = async () => {
        setExporting(true);
        try {
            const url = `/api/campaign/${campaignId}/export/roi-report?organizationId=${organizationId}&avgDealSize=${avgDealSize}`;
            const res = await api.get(url);
            const blob = await res.blob();
            const objectUrl = URL.createObjectURL(blob);
            const link = document.createElement('a');
            link.href = objectUrl;
            link.download = `netjana-roi-${campaignId}.pdf`;
            link.click();
            URL.revokeObjectURL(objectUrl);
            setLastExport(new Date().toLocaleTimeString());
        } catch (e) {
            console.error(e);
        } finally {
            setExporting(false);
        }
    };

    const handleShare = async () => {
        setExporting(true);
        try {
            const res = await api.get(`/api/campaign/${campaignId}/export/roi-report?organizationId=${organizationId}&avgDealSize=${avgDealSize}&share=true`);
            const data = await res.json();
            setShareUrl(data.shareUrl);
            navigator.clipboard.writeText(`${window.location.origin}${data.shareUrl}`);
        } catch (e) {
            console.error(e);
        } finally {
            setExporting(false);
        }
    };

    return (
        <div className="bg-slate-900/40 rounded-3xl border border-slate-800 p-8 shadow-2xl">
            <div className="flex items-start justify-between mb-8">
                <div>
                    <h2 className="text-2xl font-black text-white flex items-center gap-3">
                        <FileDown className="text-indigo-400 w-7 h-7" />
                        Campaign ROI Report
                    </h2>
                    <p className="text-slate-500 text-xs mt-1 font-medium tracking-tight uppercase">High-Verity Performance Justification Protocol</p>
                </div>
                {lastExport && (
                    <div className="flex items-center gap-2 px-3 py-1 bg-emerald-500/10 rounded-full border border-emerald-500/20 text-[10px] text-emerald-400 font-black">
                        <CheckCircle2 className="w-3 h-3" /> LAST EXPORT: {lastExport}
                    </div>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-8 mb-8">
                <div className="space-y-4">
                    <label className="block">
                        <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest ml-1">AVG Deal Size (₹)</span>
                        <div className="relative mt-2">
                            <span className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 font-bold">₹</span>
                            <input 
                                type="number" 
                                value={avgDealSize}
                                onChange={(e) => setAvgDealSize(parseInt(e.target.value))}
                                className="w-full bg-slate-950/50 border border-slate-800 rounded-2xl py-3 pl-10 pr-4 text-white font-black focus:border-indigo-500 focus:ring-1 focus:ring-indigo-500 outline-none transition-all"
                            />
                        </div>
                        <p className="text-[9px] text-slate-600 mt-2 italic px-1">Used to calculate potential pipeline value from Indian/UAE corridor signals.</p>
                    </label>
                </div>

                <div className="bg-slate-950/50 rounded-2xl border border-slate-800/50 p-5">
                    <div className="flex items-start gap-4">
                        <ShieldAlert className="text-amber-500 w-5 h-5 flex-shrink-0 mt-0.5" />
                        <div>
                            <p className="text-xs font-bold text-slate-300">Share Summary Logic</p>
                            <p className="text-[10px] text-slate-500 mt-1 leading-relaxed">
                                Redacted summary strips all PII (Company names, contacts). 
                                Generates a secure HMAC-signed link valid for 30 days. 
                                <span className="text-amber-400/80 font-bold ml-1 italic">NetJana Sovereign Firewall active.</span>
                            </p>
                        </div>
                    </div>
                </div>
            </div>

            <div className="flex flex-col sm:flex-row gap-4">
                <button 
                    onClick={handleDownload}
                    disabled={exporting}
                    className="flex-1 group relative flex items-center justify-center gap-3 py-4 bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-800 text-white font-black rounded-2xl transition-all shadow-xl shadow-indigo-600/20 overflow-hidden"
                >
                    {exporting ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Download className="w-5 h-5 group-hover:-translate-y-1 transition-transform" />}
                    <span>DOWNLOAD FULL REPORT</span>
                    <div className="absolute inset-0 bg-white/5 opacity-0 group-hover:opacity-100 transition-opacity" />
                </button>

                <button 
                    onClick={handleShare}
                    disabled={exporting}
                    className="flex-1 group flex items-center justify-center gap-3 py-4 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 text-slate-300 hover:text-white font-black rounded-2xl border border-slate-700 transition-all"
                >
                    <Share2 className="w-5 h-5 group-hover:scale-110 transition-transform" />
                    <span>{shareUrl ? 'LINK COPIED' : 'SHARE REDACTED SUMMARY'}</span>
                </button>
            </div>

            {shareUrl && (
                <div className="mt-6 p-4 bg-slate-950/80 border border-slate-800 rounded-2xl flex items-center justify-between animate-in fade-in slide-in-from-bottom-2 duration-300">
                    <div className="flex items-center gap-3 overflow-hidden">
                        <ExternalLink className="w-4 h-4 text-slate-600 flex-shrink-0" />
                        <span className="text-[11px] text-slate-400 font-mono truncate">{window.location.origin}{shareUrl}</span>
                    </div>
                    <button onClick={() => setShareUrl(null)} className="text-[10px] font-bold text-slate-600 hover:text-slate-400 uppercase ml-4">Close</button>
                </div>
            )}
        </div>
    );
};

export default ROIExportPanel;

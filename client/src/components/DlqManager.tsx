import React, { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { 
    AlertCircle, 
    RefreshCcw, 
    Trash2, 
    ExternalLink, 
    Clock, 
    Database,
    ChevronRight,
    Search,
    Filter
} from 'lucide-react';

interface FailedSignal {
    id: string;
    url: string;
    error: string;
    rawText: string;
    llmResponse?: string;
    sourceQueue?: string;
    timestamp: string;
    organizationId?: string;
}

const DlqManager: React.FC = () => {
    const [failures, setFailures] = useState<FailedSignal[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [filter, setFilter] = useState('');

    const fetchDlq = async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/api/admin/dlq');
            if (res.ok) {
                const data = await res.json();
                setFailures(data);
            }
        } catch (e) {
            console.error('[DLQ] Fetch failed:', e);
        } finally {
            setIsLoading(false);
        }
    };

    useEffect(() => {
        fetchDlq();
    }, []);

    const handleRetry = async (id: string) => {
        try {
            const res = await api.post(`/api/admin/dlq/${id}/retry`, {});
            if (res.ok) {
                setFailures(prev => prev.filter(f => f.id !== id));
                if (selectedId === id) setSelectedId(null);
            }
        } catch (e) {
            console.error('[DLQ] Retry failed:', e);
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Are you sure you want to discard this failed signal?')) return;
        try {
            const res = await api.delete(`/api/admin/dlq/${id}`);
            if (res.ok) {
                setFailures(prev => prev.filter(f => f.id !== id));
                if (selectedId === id) setSelectedId(null);
            }
        } catch (e) {
            console.error('[DLQ] Delete failed:', e);
        }
    };

    const selectedSignal = failures.find(f => f.id === selectedId);

    const filteredFailures = failures.filter(f => 
        f.url.toLowerCase().includes(filter.toLowerCase()) || 
        f.error.toLowerCase().includes(filter.toLowerCase())
    );

    return (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 animate-in fade-in duration-500 h-[calc(100vh-300px)]">
            {/* List Side */}
            <div className="lg:col-span-12 flex flex-col glass-panel border-white/5 bg-black/40 overflow-hidden">
                <div className="p-6 border-b border-white/5 flex items-center justify-between gap-4">
                    <div className="flex items-center gap-4">
                        <div className="w-10 h-10 rounded-xl bg-red-500/10 border border-red-500/20 flex items-center justify-center">
                            <AlertCircle className="w-5 h-5 text-red-400" />
                        </div>
                        <div>
                            <h3 className="text-sm font-black uppercase tracking-[3px] text-white">Dead Letter Queue</h3>
                            <p className="text-[10px] text-white/30 font-bold uppercase tracking-widest mt-0.5">
                                {failures.length} Signals Intercepted in Failure State
                            </p>
                        </div>
                    </div>

                    <div className="flex items-center gap-4">
                        <div className="relative">
                            <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
                            <input 
                                type="text" 
                                placeholder="Filter errors or URLs..."
                                value={filter}
                                onChange={(e) => setFilter(e.target.value)}
                                className="pl-10 pr-4 py-2 bg-white/5 border border-white/5 rounded-lg text-xs focus:outline-none focus:border-red-500/40 transition-all w-64"
                            />
                        </div>
                        <button 
                            onClick={fetchDlq}
                            className="p-2 hover:bg-white/5 rounded-lg transition-colors text-white/40 hover:text-white"
                        >
                            <RefreshCcw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 flex min-h-0">
                    {/* Failure Table */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar border-r border-white/5">
                        {filteredFailures.length === 0 ? (
                            <div className="h-full flex flex-col items-center justify-center opacity-20 py-20">
                                <Database className="w-12 h-12 mb-4" />
                                <span className="text-xs font-black uppercase tracking-widest">No failed signals in queue</span>
                            </div>
                        ) : (
                            <table className="w-full text-left border-collapse">
                                <thead className="sticky top-0 bg-[#0A0A0A] z-10">
                                    <tr className="bg-white/[0.02]">
                                        <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Intercept Time</th>
                                        <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Target Resource</th>
                                        <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5">Failure Protocol</th>
                                        <th className="py-3 px-6 text-[9px] font-black uppercase tracking-widest text-white/30 border-b border-white/5 text-right">Actions</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-white/[0.02]">
                                    {filteredFailures.map((f) => (
                                        <tr 
                                            key={f.id} 
                                            onClick={() => setSelectedId(f.id)}
                                            className={`group cursor-pointer transition-colors ${selectedId === f.id ? 'bg-red-500/5' : 'hover:bg-white/[0.03]'}`}
                                        >
                                            <td className="py-4 px-6">
                                                <div className="flex items-center gap-2 text-[10px] font-mono text-white/40">
                                                    <Clock className="w-3 h-3" />
                                                    {new Date(f.timestamp).toLocaleTimeString()}
                                                </div>
                                            </td>
                                            <td className="py-4 px-6 max-w-[300px]">
                                                <div className="text-xs font-bold text-white truncate">{f.url}</div>
                                                <div className="text-[9px] font-black uppercase tracking-widest text-white/20 mt-1">{f.sourceQueue || 'UNKNOWN_TIER'}</div>
                                            </td>
                                            <td className="py-4 px-6">
                                                <div className="text-[10px] font-mono text-red-400 truncate max-w-[250px]">{f.error}</div>
                                            </td>
                                            <td className="py-4 px-6 text-right">
                                                <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleRetry(f.id); }}
                                                        className="p-2 hover:bg-emerald-500/10 rounded-lg text-emerald-400/60 hover:text-emerald-400 transition-all border border-transparent hover:border-emerald-500/20"
                                                        title="Retry Signal"
                                                    >
                                                        <RefreshCcw className="w-3.5 h-3.5" />
                                                    </button>
                                                    <button 
                                                        onClick={(e) => { e.stopPropagation(); handleDelete(f.id); }}
                                                        className="p-2 hover:bg-red-500/10 rounded-lg text-red-400/60 hover:text-red-400 transition-all border border-transparent hover:border-red-500/20"
                                                        title="Discard Signal"
                                                    >
                                                        <Trash2 className="w-3.5 h-3.5" />
                                                    </button>
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}
                    </div>

                    {/* Inspector Side */}
                    <div className="w-[450px] flex flex-col bg-white/[0.01]">
                        {selectedSignal ? (
                            <div className="flex-1 flex flex-col min-h-0 animate-in slide-in-from-right-4 duration-300">
                                <div className="p-6 border-b border-white/5 space-y-4">
                                    <h4 className="text-[10px] font-black uppercase tracking-[2px] text-white/60">Signal Inspector</h4>
                                    <div className="p-4 bg-red-500/5 border border-red-500/10 rounded-xl space-y-2">
                                        <div className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-red-400">
                                            <AlertCircle className="w-3 h-3" /> Exception Log
                                        </div>
                                        <p className="text-xs font-mono text-red-300 leading-relaxed whitespace-pre-wrap">
                                            {selectedSignal.error}
                                        </p>
                                    </div>
                                </div>

                                <div className="flex-1 overflow-y-auto p-6 custom-scrollbar space-y-6">
                                    <div>
                                        <h5 className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-3">Intercept Raw Payload</h5>
                                        <div className="p-4 bg-black/60 border border-white/10 rounded-xl font-mono text-[10px] text-white/60 whitespace-pre-wrap leading-relaxed max-h-[400px] overflow-y-auto scrollbar-none">
                                            {selectedSignal.rawText}
                                        </div>
                                    </div>

                                    {selectedSignal.llmResponse && (
                                        <div>
                                            <h5 className="text-[9px] font-black uppercase tracking-widest text-white/40 mb-3">LLM Partial Response</h5>
                                            <div className="p-4 bg-white/5 border border-white/5 rounded-xl font-mono text-[10px] text-emerald-400/60 whitespace-pre-wrap italic">
                                                {selectedSignal.llmResponse}
                                            </div>
                                        </div>
                                    )}

                                    <div className="grid grid-cols-2 gap-4">
                                        <div className="p-4 bg-white/5 border border-white/5 rounded-xl">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-1">Tenant ID</span>
                                            <code className="text-[10px] text-white/60">{selectedSignal.organizationId?.substring(0, 12)}...</code>
                                        </div>
                                        <div className="p-4 bg-white/5 border border-white/5 rounded-xl">
                                            <span className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-1">Retries Allowed</span>
                                            <code className="text-[10px] text-white/60">ENABLED</code>
                                        </div>
                                    </div>
                                </div>

                                <div className="p-6 border-t border-white/5 bg-black/40 flex gap-4">
                                    <button 
                                        onClick={() => handleRetry(selectedSignal.id)}
                                        className="flex-1 py-3 bg-emerald-500 text-black text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-emerald-400 transition-all shadow-[0_4px_20px_rgba(16,185,129,0.2)]"
                                    >
                                        Initiate Re-analysis
                                    </button>
                                    <button 
                                        onClick={() => handleDelete(selectedSignal.id)}
                                        className="px-4 py-3 border border-white/10 text-white/40 hover:text-white rounded-xl transition-colors hover:bg-white/5"
                                    >
                                        <Trash2 className="w-4 h-4" />
                                    </button>
                                </div>
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-center p-12 opacity-30">
                                <ChevronRight className="w-12 h-12 mb-4 animate-pulse" />
                                <span className="text-[10px] font-black uppercase tracking-[3px]">Select signal to audit</span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default DlqManager;

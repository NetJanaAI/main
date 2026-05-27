import { useCallback, useState, useEffect } from 'react';
import { UploadCloud, Eye, Plus, CheckCircle, AlertTriangle } from 'lucide-react';
import { api } from '../../lib/api';

interface WatchProfile {
    profile_id: string;
    keywords: string[];
    regions: string[];
    min_amount: number;
    is_active: boolean;
}

export default function TenderWatch() {
    const [profiles, setProfiles] = useState<WatchProfile[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [uploading, setUploading] = useState(false);
    const [uploadStatus, setUploadStatus] = useState<{ type: 'success' | 'error', message: string } | null>(null);

    // Form state
    const [newKeyword, setNewKeyword] = useState('');
    const [newRegion, setNewRegion] = useState('');

    const fetchProfiles = useCallback(async () => {
        setIsLoading(true);
        try {
            const res = await api.get('/api/watch-profiles');
            if (res.ok) {
                const data = await res.json();
                setProfiles(data.profiles || []);
            }
        } catch (e) {
            console.error('Failed to fetch profiles', e);
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        fetchProfiles();
    }, [fetchProfiles]);

    const handleCreateProfile = async () => {
        if (!newKeyword && !newRegion) return;
        
        const keywords = newKeyword.split(',').map(k => k.trim()).filter(Boolean);
        const regions = newRegion.split(',').map(r => r.trim()).filter(Boolean);
        
        try {
            const res = await api.post('/api/watch-profiles', { keywords, regions, min_amount: 0 });
            if (res.ok) {
                setNewKeyword('');
                setNewRegion('');
                fetchProfiles();
            }
        } catch (e) {
            console.error('Failed to create profile', e);
        }
    };

    const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setUploading(true);
        setUploadStatus(null);
        
        const formData = new FormData();
        formData.append('file', file);

        try {
            const res = await api.postForm('/api/watch-profiles/upload', formData);
            
            const data = await res.json();
            if (res.ok) {
                setUploadStatus({ type: 'success', message: data.message });
                fetchProfiles();
            } else {
                setUploadStatus({ type: 'error', message: data.error || 'Upload failed' });
            }
        } catch (e: any) {
            setUploadStatus({ type: 'error', message: e.message });
        } finally {
            setUploading(false);
            if (e.target) e.target.value = ''; // Reset file input
        }
    };

    return (
        <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <header className="mb-8">
                <div className="flex items-center gap-3 mb-2">
                    <Eye className="w-6 h-6 text-[#00ffca]" />
                    <h1 className="text-2xl font-black uppercase tracking-widest text-[#00ffca]">Tender Watch Protocol</h1>
                </div>
                <p className="text-xs uppercase tracking-widest text-white/40">
                    Automated registry monitoring and semantic pattern matching for incoming tenders.
                </p>
            </header>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                
                {/* Left Col: Create & Upload */}
                <div className="space-y-6">
                    {/* Create Profile Card */}
                    <div className="p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-md">
                        <h2 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                            <Plus className="w-3 h-3" /> New Watch Profile
                        </h2>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-[9px] uppercase tracking-widest text-white/30 mb-1">Keywords (Comma separated)</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. cloud, software, CRM"
                                    value={newKeyword}
                                    onChange={e => setNewKeyword(e.target.value)}
                                    className="w-full bg-black/50 border border-white/10 rounded-md py-2 px-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00ffca]/50 focus:ring-1 focus:ring-[#00ffca]/50 transition-all"
                                />
                            </div>
                            <div>
                                <label className="block text-[9px] uppercase tracking-widest text-white/30 mb-1">Regions (Comma separated)</label>
                                <input 
                                    type="text" 
                                    placeholder="e.g. Delhi, Maharashtra, Dubai"
                                    value={newRegion}
                                    onChange={e => setNewRegion(e.target.value)}
                                    className="w-full bg-black/50 border border-white/10 rounded-md py-2 px-3 text-xs text-white placeholder-white/20 focus:outline-none focus:border-[#00ffca]/50 focus:ring-1 focus:ring-[#00ffca]/50 transition-all"
                                />
                            </div>
                            <button 
                                onClick={handleCreateProfile}
                                disabled={!newKeyword && !newRegion}
                                className="w-full py-2 bg-[#00ffca]/10 hover:bg-[#00ffca]/20 border border-[#00ffca]/20 text-[#00ffca] text-[10px] font-black uppercase tracking-widest rounded-md transition-all disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                Deploy Watch
                            </button>
                        </div>
                    </div>

                    {/* CSV Upload Card */}
                    <div className="p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-md">
                        <h2 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-4 flex items-center gap-2">
                            <UploadCloud className="w-3 h-3" /> Bulk Ingest (CSV)
                        </h2>
                        <div className="border-2 border-dashed border-white/10 rounded-lg p-6 text-center hover:bg-white/[0.02] transition-colors relative group">
                            <input 
                                type="file" 
                                accept=".csv"
                                onChange={handleFileUpload}
                                disabled={uploading}
                                className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
                            />
                            <UploadCloud className="w-8 h-8 text-white/20 mx-auto mb-2 group-hover:text-[#00ffca] transition-colors" />
                            <p className="text-[10px] uppercase tracking-widest text-white/40">
                                {uploading ? 'Processing Matrix...' : 'Drop CSV or click to browse'}
                            </p>
                            <p className="text-[8px] uppercase tracking-[2px] text-white/20 mt-2">
                                Format: keywords, regions, min_amount
                            </p>
                        </div>
                        {uploadStatus && (
                            <div className={`mt-4 p-3 rounded-md text-[10px] flex items-center gap-2 ${uploadStatus.type === 'success' ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-red-500/10 text-red-400 border border-red-500/20'}`}>
                                {uploadStatus.type === 'success' ? <CheckCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
                                {uploadStatus.message}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right Col: Active Profiles */}
                <div className="lg:col-span-2">
                    <div className="p-6 rounded-xl border border-white/5 bg-white/[0.02] backdrop-blur-md min-h-[500px]">
                        <h2 className="text-[10px] font-black uppercase tracking-widest text-white/40 mb-6 flex items-center justify-between">
                            <span>Active Watch Profiles</span>
                            <span className="bg-white/5 px-2 py-1 rounded text-[#00ffca]">{profiles.length} Nodes</span>
                        </h2>

                        {isLoading ? (
                            <div className="flex items-center justify-center h-48">
                                <div className="w-5 h-5 rounded-full border-2 border-[#00ffca]/30 border-t-[#00ffca] animate-spin" />
                            </div>
                        ) : profiles.length === 0 ? (
                            <div className="flex flex-col items-center justify-center h-48 text-center">
                                <Eye className="w-8 h-8 text-white/10 mb-3" />
                                <p className="text-[10px] uppercase tracking-widest text-white/30">No active watch nodes</p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {profiles.map(p => (
                                    <div key={p.profile_id} className="p-4 rounded-lg bg-black/40 border border-white/5 flex flex-col md:flex-row md:items-center justify-between gap-4 group hover:border-white/10 transition-colors">
                                        <div className="flex-1 space-y-2">
                                            <div className="flex flex-wrap gap-2">
                                                {p.keywords?.map((kw, i) => (
                                                    <span key={i} className="px-2 py-1 rounded-md bg-[#00ffca]/10 text-[#00ffca] text-[9px] font-bold uppercase tracking-wider border border-[#00ffca]/20">
                                                        {kw}
                                                    </span>
                                                ))}
                                                {(!p.keywords || p.keywords.length === 0) && (
                                                    <span className="text-[9px] uppercase text-white/20">All Keywords</span>
                                                )}
                                            </div>
                                            <div className="flex flex-wrap gap-2">
                                                {p.regions?.map((reg, i) => (
                                                    <span key={i} className="px-2 py-1 rounded-md bg-blue-500/10 text-blue-400 text-[9px] font-bold uppercase tracking-wider border border-blue-500/20">
                                                        {reg}
                                                    </span>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-4 shrink-0">
                                            <div className="text-right">
                                                <span className="block text-[8px] uppercase tracking-[2px] text-white/30 mb-0.5">Status</span>
                                                <span className="flex items-center gap-1 text-[10px] text-green-400 font-bold uppercase tracking-wider">
                                                    <div className="w-1.5 h-1.5 rounded-full bg-green-400 animate-pulse" /> Active
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

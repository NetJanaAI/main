import React, { useState } from 'react';
import { Search, Loader2 } from 'lucide-react';

interface UrlInputProps {
    onScrape: (url: string, useOnlineAI: boolean, spiderMode: boolean, maxPages: number) => void;
    isLoading: boolean;
}

export const UrlInput: React.FC<UrlInputProps> = ({ onScrape, isLoading }) => {
    const [url, setUrl] = useState('');
    const [useOnlineAI, setUseOnlineAI] = useState(false);
    const [spiderMode, setSpiderMode] = useState(false);
    const [maxPages, setMaxPages] = useState<number>(5);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (url && !isLoading) {
            onScrape(url, useOnlineAI, spiderMode, maxPages);
        }
    };

    return (
        <form onSubmit={handleSubmit} className="w-full max-w-3xl mx-auto">
            <div className="glass-panel p-3 border-white/5 flex items-center gap-4 bg-white/[0.02]">
                <div className="p-3 bg-white/5 rounded-2xl">
                    <Search className="w-5 h-5 text-white/40" />
                </div>
                <input
                    type="url"
                    placeholder="ENTER PERSISTENT TARGET DOMAIN (HTTPS://...)"
                    className="flex-1 bg-transparent border-none focus:ring-0 text-white font-black uppercase tracking-[2px] text-[10px] placeholder:text-white/10"
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    required
                />
                <button
                    type="submit"
                    disabled={isLoading}
                    className="btn-premium disabled:opacity-50 disabled:scale-100 flex items-center gap-3"
                >
                    {isLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Execute Scrape'}
                </button>
            </div>

            <div className="flex flex-col items-center gap-6 mt-8">
                <div className="flex justify-center gap-10 w-full">
                    <label className="flex items-center gap-4 cursor-pointer group">
                        <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={useOnlineAI}
                            onChange={(e) => setUseOnlineAI(e.target.checked)}
                        />
                        <div className="w-12 h-6 bg-white/5 border border-white/10 rounded-full peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-primary after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white/10 after:border-white/20 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary/20 peer-checked:border-primary/40 relative"></div>
                        <span className="text-[9px] font-black uppercase tracking-[3px] text-white/20 group-hover:text-white/50 transition-colors">
                            Online AI (Gemini Pro)
                        </span>
                    </label>

                    <label className="flex items-center gap-4 cursor-pointer group">
                        <input
                            type="checkbox"
                            className="peer sr-only"
                            checked={spiderMode}
                            onChange={(e) => setSpiderMode(e.target.checked)}
                        />
                        <div className="w-12 h-6 bg-white/5 border border-white/10 rounded-full peer-focus:outline-none peer-checked:after:translate-x-full peer-checked:after:border-primary after:content-[''] after:absolute after:top-[4px] after:left-[4px] after:bg-white/10 after:border-white/20 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-primary/20 peer-checked:border-primary/40 relative"></div>
                        <span className="text-[9px] font-black uppercase tracking-[3px] text-white/20 group-hover:text-white/50 transition-colors">
                            Deep Spider Mode
                        </span>
                    </label>
                </div>

                {spiderMode && (
                    <div className="flex items-center gap-6 bg-white/[0.02] border border-white/5 px-6 py-3 rounded-2xl animate-in fade-in slide-in-from-top-2 duration-300">
                        <span className="text-[9px] font-black uppercase tracking-[3px] text-white/40">Max Pages Crawl:</span>
                        <input 
                            type="range" 
                            min="1" 
                            max="20" 
                            step="1"
                            value={maxPages}
                            onChange={(e) => setMaxPages(parseInt(e.target.value))}
                            className="w-40 accent-primary" 
                        />
                        <span className="text-[12px] font-black text-primary min-w-[20px] text-center">{maxPages}</span>
                    </div>
                )}
            </div>
        </form >
    );
};

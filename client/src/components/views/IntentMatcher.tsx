import React, { useState } from 'react';
import { Target, Search, Filter, AlertCircle, ArrowRight, ShieldAlert } from 'lucide-react';
import { api } from '../../lib/api';

export default function IntentMatcher() {
  const [industry, setIndustry] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [apiError, setApiError] = useState<{ status: number; message: string } | null>(null);

  const fetchMatches = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setHasSearched(true);
    setApiError(null);
    setMatches([]);
    try {
      const qs = new URLSearchParams();
      if (industry) qs.append('industry', industry);
      if (query) qs.append('query', query);

      const res = await api.get(`/api/leads/match?${qs.toString()}`);
      if (!res.ok) {
        let errMsg = `HTTP ${res.status}: ${res.statusText}`;
        try { const body = await res.json(); errMsg = body.error || body.message || errMsg; } catch {}
        setApiError({ status: res.status, message: errMsg });
        return;
      }
      const data = await res.json();
      setMatches(data.matches || []);
    } catch (err: any) {
      setApiError({ status: 0, message: err?.message || 'Network failure — backend unreachable' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-fade-in">
      <div className="flex items-center gap-3 mb-2">
        <Target className="w-8 h-8 text-[#D4AF37]" />
        <div>
          <h2 className="text-2xl font-serif tracking-tight text-white mb-1">Semantic Intent Matcher</h2>
          <p className="text-sm text-white/50">Cross-reference active registry signals directly against your target market criteria.</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/10 p-6 rounded-xl backdrop-blur-md">
        <form onSubmit={fetchMatches} className="flex flex-col md:flex-row gap-4 items-end">
          <div className="flex-1 w-full">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#D4AF37] mb-2">Industry / Sector</label>
            <div className="relative">
              <Filter className="absolute left-3 top-2.5 w-4 h-4 text-white/30" />
              <input 
                type="text" 
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                placeholder="e.g. IT Services, Construction"
                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-white focus:outline-none focus:border-[#D4AF37]/50"
              />
            </div>
          </div>
          <div className="flex-1 w-full">
            <label className="block text-xs font-bold uppercase tracking-widest text-[#D4AF37] mb-2">Product Query / Company Focus</label>
            <div className="relative">
              <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/30" />
              <input 
                type="text" 
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="e.g. Cloud Infrastructure, Heavy Machinery"
                className="w-full bg-black/40 border border-white/10 rounded-lg py-2 pl-9 pr-4 text-white focus:outline-none focus:border-[#D4AF37]/50"
              />
            </div>
          </div>
          <button 
            type="submit" 
            disabled={loading}
            className="h-10 px-6 bg-[#D4AF37] hover:bg-[#D4AF37]/80 text-black font-bold uppercase tracking-wider rounded-lg transition-colors flex items-center justify-center min-w-[140px]"
          >
            {loading ? 'Scanning...' : 'Match Alpha'}
          </button>
        </form>
      </div>

      <div className="space-y-4">
        {loading && <div className="text-center text-white/50 py-10 animate-pulse">Scanning Registry Vault...</div>}

        {/* ADVERSARIAL: Hard-surface API failures. Never appease with 'No Results' on error. */}
        {!loading && apiError && (
          <div className="bg-red-950/40 border border-red-500/40 rounded-xl p-8 flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <ShieldAlert className="w-6 h-6 text-red-400 shrink-0" />
              <span className="text-xs font-black uppercase tracking-widest text-red-400">ERR_CRITICAL_FAILURE — Backend returned error</span>
            </div>
            <div className="bg-black/40 border border-red-500/20 rounded-lg px-4 py-3 font-mono text-xs text-red-300">
              {apiError.status > 0 ? `[${apiError.status}] ` : '[NETWORK] '}{apiError.message}
            </div>
            <p className="text-[10px] text-red-400/60 uppercase tracking-widest font-bold">The Intent Matcher endpoint is unavailable or misconfigured. This is not a 'no results' state — it is a system failure.</p>
          </div>
        )}
        
        {!loading && !apiError && hasSearched && matches.length === 0 && (
          <div className="text-center bg-white/5 border border-white/10 rounded-xl p-10 flex flex-col items-center">
            <AlertCircle className="w-10 h-10 text-white/30 mb-3" />
            <h3 className="text-white/60 font-semibold mb-1">No Intent Matches Found</h3>
            <p className="text-white/40 text-sm max-w-md">API responded successfully with zero matches for your constraints. Refine your sector or query filters.</p>
          </div>
        )}

        {!loading && hasSearched && matches.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-4">
            {matches.map((lead, idx) => (
              <div key={idx} className="bg-black/40 border border-[#D4AF37]/20 p-5 rounded-xl hover:border-[#D4AF37]/50 transition-colors flex flex-col justify-between">
                <div>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <h3 className="text-lg font-bold text-[#D4AF37] truncate">{lead.company_name}</h3>
                      <div className="flex gap-2 items-center text-xs text-white/40 mt-1 uppercase tracking-wider">
                        <span>{lead.geo_state}</span>
                        <span>•</span>
                        <span className="truncate max-w-[150px]">{lead.sector || 'Uncategorized'}</span>
                      </div>
                    </div>
                    <div className="bg-emerald-500/10 text-emerald-400 px-3 py-1 rounded-full text-xs font-bold border border-emerald-500/20">
                      Score: {lead.intent_score}
                    </div>
                  </div>
                  
                  <div className="bg-white/5 p-3 rounded border border-white/5 mb-4">
                    <p className="text-sm text-white/80 line-clamp-2"><span className="text-white/40 font-bold mr-2">CONTEXT:</span>{lead.card_why_now}</p>
                    <p className="text-sm text-[#D4AF37] font-semibold mt-2 truncate"><span className="text-white/40 font-bold mr-2">NEEDS:</span>{lead.card_what_they_need}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                   <button className="text-xs font-bold text-white/50 hover:text-white uppercase flex items-center gap-1 transition-colors">
                     View Full Intel Graph <ArrowRight className="w-3 h-3" />
                   </button>
                   <button className="bg-white/10 hover:bg-white/20 px-4 py-1.5 rounded text-xs font-bold uppercase transition-colors">
                     Draft Outreach
                   </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

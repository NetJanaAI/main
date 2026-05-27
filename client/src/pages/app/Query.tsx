import { useState } from 'react';
import { Search, Filter, ArrowRight, Activity, Zap } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { LeadCard } from '../../types';
import { api } from '../../lib/api';

export default function Query() {
  const [industry, setIndustry] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(false);
  const [matches, setMatches] = useState<any[]>([]);
  const [hasSearched, setHasSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchMatches = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setHasSearched(true);
    setError(null);
    try {
      const qs = new URLSearchParams();
      if (industry) qs.append('industry', industry);
      if (query) qs.append('query', query);

      const res = await api.get(`/api/leads/match?${qs.toString()}`);
      if (!res.ok) throw new Error('Failed to fetch matches');
      const data = await res.json();
      setMatches(data.matches || []);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Intent matcher request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-12 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-serif italic text-white tracking-widest uppercase">Intent Matcher</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px] mt-1">Cross-Registry Cross-Reference Node</p>
        </div>
      </div>

      <div className="bg-white/5 border border-white/5 p-12 rounded-2xl backdrop-blur-3xl shadow-6xl relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-[#D4AF37]/5 blur-3xl pointer-events-none -mr-32 -mt-32" />
        
        <form onSubmit={fetchMatches} className="relative z-10 grid lg:grid-cols-12 gap-8 items-end">
          <div className="lg:col-span-5 space-y-3">
            <label className="block text-[10px] font-black uppercase tracking-[3px] text-[#D4AF37]">Industry / Global Sector</label>
            <div className="relative">
              <Filter className="absolute left-4 top-3.5 w-5 h-5 text-white/30" />
              <input 
                type="text" 
                value={industry}
                onChange={e => setIndustry(e.target.value)}
                placeholder="E.G. IT SERVICES, LOGISTICS..."
                className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-xs font-bold uppercase tracking-widest text-white focus:outline-none focus:border-[#D4AF37]/50"
              />
            </div>
          </div>
          <div className="lg:col-span-5 space-y-3">
            <label className="block text-[10px] font-black uppercase tracking-[3px] text-[#D4AF37]">Product / Entity Constraints</label>
            <div className="relative">
              <Search className="absolute left-4 top-3.5 w-5 h-5 text-white/30" />
              <input 
                type="text" 
                value={query}
                onChange={e => setQuery(e.target.value)}
                placeholder="E.G. CLOUD STACK, MATERIAL HANDLING..."
                className="w-full bg-black/40 border border-white/10 rounded-xl py-4 pl-12 pr-4 text-xs font-bold uppercase tracking-widest text-white focus:outline-none focus:border-[#D4AF37]/50"
              />
            </div>
          </div>
          <div className="lg:col-span-2">
            <button 
              type="submit" 
              disabled={loading}
              className="h-14 w-full bg-[#D4AF37] text-black text-xs font-black uppercase tracking-[3px] rounded-xl shadow-[0_0_20px_rgba(212,175,55,0.2)] hover:bg-[#D4AF37]/80 hover:shadow-[0_0_30px_rgba(212,175,55,0.4)] transition-all leading-none"
            >
              {loading ? 'SCALING...' : 'MATCH ALPHA'}
            </button>
          </div>
        </form>
      </div>

      <div className="space-y-6">
        {loading && <div className="text-center text-[10px] font-black uppercase tracking-[4px] text-[#D4AF37] py-24 animate-pulse">Initializing Signal Alignment Sequence...</div>}
        
        {!loading && error && (
          <div className="text-center bg-red-950/30 border border-red-500/30 rounded-2xl p-10 flex flex-col items-center">
            <Activity className="w-12 h-12 text-red-400/60 mb-6" />
            <h3 className="text-red-300 font-black uppercase tracking-widest text-lg mb-2">Matcher Unavailable</h3>
            <p className="text-red-200/60 text-[10px] font-bold uppercase tracking-[2px] max-w-sm">{error}</p>
          </div>
        )}

        {!loading && !error && hasSearched && matches.length === 0 && (
          <div className="text-center bg-white/5 border border-white/10 rounded-2xl p-24 flex flex-col items-center">
            <Activity className="w-12 h-12 text-white/10 mb-6 animate-pulse" />
            <h3 className="text-white/60 font-black uppercase tracking-widest text-lg mb-2">Zero Matching Constraints Found</h3>
            <p className="text-white/20 text-[10px] font-bold uppercase tracking-[2px] max-w-sm">Registry vaults returned no active intent signals for this specific cross-reference.</p>
          </div>
        )}

        {!loading && !error && hasSearched && matches.length > 0 && (
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-8">
            {matches.map((lead: LeadCard, idx: number) => (
              <div key={idx} className="bg-black/40 border border-white/5 p-8 rounded-2xl group hover:border-[#D4AF37]/40 transition-all flex flex-col justify-between backdrop-blur-md">
                <div>
                  <div className="flex justify-between items-start mb-6">
                    <div>
                      <h3 className="text-xl font-bold font-serif text-[#D4AF37] group-hover:text-white transition-colors uppercase italic italic-strong leading-none">{lead.company_name}</h3>
                      <div className="flex gap-3 items-center text-[10px] font-black uppercase tracking-widest text-white/30 mt-3">
                        <span className="text-white/60">{lead.geo_state} Cluster</span>
                        <span>·</span>
                        <span className="truncate max-w-[150px]">{lead.sector || 'Unclassified'}</span>
                      </div>
                    </div>
                    <div className="bg-[#D4AF37]/10 text-[#D4AF37] px-4 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border border-[#D4AF37]/20">
                      Score: {lead.intent_score} AQ
                    </div>
                  </div>
                  
                  <div className="bg-white/5 p-6 rounded-xl border border-white/5 mb-8 relative overflow-hidden group-hover:bg-white/[0.08] transition-colors">
                     <span className="text-[9px] font-black uppercase tracking-widest text-white/20 block mb-4 border-b border-white/10 pb-2">Verified Alpha Logic</span>
                    <p className="text-sm text-white/80 line-clamp-3 font-serif leading-relaxed mb-4 italic italic-strong">{lead.card_why_now}</p>
                    <p className="text-sm text-[#D4AF37] font-bold uppercase tracking-wider truncate mb-2 mt-2"><Zap className="w-3 h-3 inline-block -mt-1 mr-2" /> {lead.card_what_they_need}</p>
                  </div>
                </div>

                <div className="flex justify-between items-center pt-2">
                   <Link to="/app/signals" className="text-[10px] font-black uppercase tracking-widest text-white/30 hover:text-white flex items-center gap-2 transition-colors">
                     View Signal Matrix <ArrowRight className="w-3 h-3" />
                   </Link>
                   <Link to="/app/signals" className="bg-white/5 border border-white/10 hover:bg-white/10 px-6 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest text-white transition-all leading-none">
                     Generate Outreach
                   </Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

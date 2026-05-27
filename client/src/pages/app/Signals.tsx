import {
  Search,
  Filter,
  ChevronRight,
  Shield
} from 'lucide-react';
import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import SignalRow from '../../components/SignalRow';
import { useAppStore } from '../../store/appStore';
import type { LeadCard } from '../../types';
import { api } from '../../lib/api';

export default function Signals() {
  const { market } = useAppStore();
  const [leads, setLeads] = useState<LeadCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedLead, setSelectedLead] = useState<LeadCard | null>(null);

  useEffect(() => {
    fetchLeads();
  }, [market]);

  const fetchLeads = async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await api.get(`/api/leads/match?query=`);
      const data = await resp.json();
      setLeads(data.matches || []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Signal matrix request failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-sans italic text-white tracking-widest uppercase">Signal Matrix</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px] mt-1">Sovereign Alpha Layer Ingestion Stream</p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
             <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/20" />
             <input
               type="text"
               placeholder="SEARCH ENTITIES..."
               className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-[10px] font-black uppercase tracking-widest text-white focus:outline-none focus:border-[#00ffca]/50"
             />
          </div>
          <button className="p-2 bg-white/5 border border-white/10 rounded-lg text-white/40 hover:text-white transition-colors">
            <Filter className="w-5 h-5" />
          </button>
        </div>
      </div>

      <div className="grid lg:grid-cols-12 gap-8 items-start">
        {/* Signal Matrix Table */}
        <section className={`bg-black/40 border border-white/5 rounded-2xl overflow-hidden backdrop-blur-xl ${selectedLead ? 'lg:col-span-8' : 'lg:col-span-12'} transition-all duration-500`}>
          <div className="overflow-x-auto min-h-[600px]">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-white/5 border-b border-white/10">
                  <th className="py-4 px-6 text-[10px] font-black uppercase tracking-[3px] text-[#00ffca]">Entity Identity</th>
                  <th className="py-4 px-6 text-[10px] font-black uppercase tracking-[3px] text-white/30">Sector Vert</th>
                  <th className="py-4 px-6 text-[10px] font-black uppercase tracking-[3px] text-white/30">Alpha Score</th>
                  <th className="py-4 px-6 text-[10px] font-black uppercase tracking-[3px] text-white/30">Status Status</th>
                  <th className="py-4 px-6 text-[10px] font-black uppercase tracking-[3px] text-white/30 text-right">Captured</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/[0.02]">
                {loading ? (
                   [...Array(8)].map((_, i) => (
                     <tr key={i} className="animate-pulse">
                        <td className="py-6 px-6"><div className="h-4 w-32 bg-white/5 rounded" /></td>
                        <td className="py-6 px-6"><div className="h-4 w-20 bg-white/5 rounded" /></td>
                        <td className="py-6 px-6"><div className="h-4 w-10 bg-white/5 rounded" /></td>
                        <td className="py-6 px-6"><div className="h-4 w-16 bg-white/5 rounded" /></td>
                        <td className="py-6 px-6"><div className="h-4 w-24 bg-white/5 rounded ms-auto" /></td>
                     </tr>
                   ))
                ) : error ? (
                  <tr>
                    <td colSpan={5} className="py-24 px-6 text-center">
                      <div className="inline-flex flex-col items-center gap-3 rounded-xl border border-red-500/30 bg-red-950/20 px-8 py-6">
                        <Shield className="w-8 h-8 text-red-400" />
                        <span className="text-[10px] font-black uppercase tracking-widest text-red-300">Signal Matrix Unavailable</span>
                        <span className="text-xs text-red-200/60">{error}</span>
                      </div>
                    </td>
                  </tr>
                ) : leads.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-24 px-6 text-center text-[10px] font-black uppercase tracking-widest text-white/30">
                      No active signals matched this market.
                    </td>
                  </tr>
                ) : leads.map((lead, idx) => (
                  <SignalRow key={idx} lead={lead} onClick={setSelectedLead} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Lead Detail Panel */}
        {selectedLead && (
          <aside className="lg:col-span-4 bg-white/5 border border-[#00ffca]/30 rounded-2xl p-8 backdrop-blur-2xl animate-slide-in-right sticky top-8">
            <button className="mb-8 text-[10px] font-black uppercase tracking-widest text-[#00ffca] flex items-center gap-2 hover:translate-x-1 transition-transform" onClick={() => setSelectedLead(null)}>
              Close Panel <ChevronRight className="w-4 h-4" />
            </button>

            <div className="space-y-8">
              <header>
                <div className="flex items-center gap-3 mb-2">
                   <div className="p-2 bg-[#00ffca]/10 rounded border border-[#00ffca]/20">
                     <Shield className="w-5 h-5 text-[#00ffca]" />
                   </div>
                   <h2 className="text-xl font-bold text-white uppercase tracking-tight leading-tight">{selectedLead.company_name}</h2>
                </div>
                <div className="flex gap-4 text-[10px] uppercase font-black tracking-widest text-white/30">
                   <span>{selectedLead.geo_state} Cluster</span>
                   <span>·</span>
                   <span className="text-[#00ffca]">{selectedLead.sector}</span>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-white/5 p-4 rounded-xl">
                   <span className="text-[9px] font-black uppercase tracking-widest text-white/30 block mb-1">Intent Quotient</span>
                   <span className="text-2xl font-sans italic text-white leading-none">{selectedLead.intent_score}</span>
                 </div>
                 <div className="bg-white/5 p-4 rounded-xl text-right">
                   <span className="text-[9px] font-black uppercase tracking-widest text-white/30 block mb-1">Status Status</span>
                   <span className="text-2xl font-sans italic text-emerald-400 leading-none">{selectedLead.decay_status}</span>
                 </div>
              </div>

              <div className="space-y-6 pt-4 border-t border-white/5">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-2">Alpha Context (Why Now)</h4>
                  <p className="text-sm text-white/80 leading-relaxed font-sans italic italic-strong font-bold">{selectedLead.card_why_now}</p>
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-2">High-Friction Goal (Need)</h4>
                  <p className="text-sm text-[#00ffca] leading-relaxed font-sans italic font-bold">{selectedLead.card_what_they_need}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-8">
                <Link to="/app/reports" className="w-full h-12 bg-[#00ffca] text-black text-xs font-black uppercase tracking-[3px] rounded-lg shadow-[0_0_20px_rgba(0,255,202,0.15)] hover:bg-[#00ffca]/80 transition-all leading-none flex items-center justify-center">
                  Draft Intelligence Briefing
                </Link>
                <Link to="/app/query" className="w-full h-12 bg-white/5 border border-white/10 text-white text-xs font-black uppercase tracking-[3px] rounded-lg hover:bg-white/10 transition-all leading-none flex items-center justify-center">
                  Launch Outreach Node
                </Link>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

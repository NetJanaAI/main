import { 
  Search, 
  Filter, 
  ChevronRight
} from 'lucide-react';
import { useState, useEffect } from 'react';
import SignalRow from '../../components/SignalRow';
import { useAppStore } from '../../store/appStore';
import type { LeadCard } from '../../types';

export default function Signals() {
  const { market } = useAppStore();
  const [leads, setLeads] = useState<LeadCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedLead, setSelectedLead] = useState<LeadCard | null>(null);

  useEffect(() => {
    fetchLeads();
  }, [market]);

  const fetchLeads = async () => {
    setLoading(true);
    try {
      const resp = await fetch(`/api/leads/match?query=`); 
      const data = await resp.json();
      setLeads(data.matches || []);
    } catch (e) {
      console.error('Fetch leads failed', e);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-8 animate-fade-in">
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <div>
          <h1 className="text-3xl font-serif italic text-white tracking-widest uppercase">Signal Matrix</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px] mt-1">Sovereign Alpha Layer Ingestion Stream</p>
        </div>
        <div className="flex items-center gap-4 w-full md:w-auto">
          <div className="relative flex-1 md:w-64">
             <Search className="absolute left-3 top-2.5 w-4 h-4 text-white/20" />
             <input 
               type="text" 
               placeholder="SEARCH ENTITIES..." 
               className="w-full bg-white/5 border border-white/10 rounded-lg py-2 pl-10 pr-4 text-[10px] font-black uppercase tracking-widest text-white focus:outline-none focus:border-[#D4AF37]/50"
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
                  <th className="py-4 px-6 text-[10px] font-black uppercase tracking-[3px] text-[#D4AF37]">Entity Identity</th>
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
                ) : leads.map((lead, idx) => (
                  <SignalRow key={idx} lead={lead} onClick={setSelectedLead} />
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Lead Detail Panel */}
        {selectedLead && (
          <aside className="lg:col-span-4 bg-white/5 border border-[#D4AF37]/30 rounded-2xl p-8 backdrop-blur-2xl animate-slide-in-right sticky top-8">
            <button className="mb-8 text-[10px] font-black uppercase tracking-widest text-[#D4AF37] flex items-center gap-2 hover:translate-x-1 transition-transform" onClick={() => setSelectedLead(null)}>
              Close Panel <ChevronRight className="w-4 h-4" />
            </button>

            <div className="space-y-8">
              <header>
                <div className="flex items-center gap-3 mb-2">
                   <div className="p-2 bg-[#D4AF37]/10 rounded border border-[#D4AF37]/20">
                     <Shield className="w-5 h-5 text-[#D4AF37]" />
                   </div>
                   <h2 className="text-xl font-bold text-white uppercase tracking-tight leading-tight">{selectedLead.company_name}</h2>
                </div>
                <div className="flex gap-4 text-[10px] uppercase font-black tracking-widest text-white/30">
                   <span>{selectedLead.geo_state} Cluster</span>
                   <span>·</span>
                   <span className="text-[#D4AF37]">{selectedLead.sector}</span>
                </div>
              </header>

              <div className="grid grid-cols-2 gap-4">
                 <div className="bg-white/5 p-4 rounded-xl">
                   <span className="text-[9px] font-black uppercase tracking-widest text-white/30 block mb-1">Intent Quotient</span>
                   <span className="text-2xl font-serif italic text-white leading-none">{selectedLead.intent_score}</span>
                 </div>
                 <div className="bg-white/5 p-4 rounded-xl text-right">
                   <span className="text-[9px] font-black uppercase tracking-widest text-white/30 block mb-1">Status Status</span>
                   <span className="text-2xl font-serif italic text-emerald-400 leading-none">{selectedLead.decay_status}</span>
                 </div>
              </div>

              <div className="space-y-6 pt-4 border-t border-white/5">
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-2">Alpha Context (Why Now)</h4>
                  <p className="text-sm text-white/80 leading-relaxed font-serif italic italic-strong font-bold">{selectedLead.card_why_now}</p>
                </div>
                <div>
                  <h4 className="text-[10px] font-black uppercase tracking-[3px] text-white/30 mb-2">High-Friction Goal (Need)</h4>
                  <p className="text-sm text-[#D4AF37] leading-relaxed font-serif italic font-bold">{selectedLead.card_what_they_need}</p>
                </div>
              </div>

              <div className="flex flex-col gap-3 pt-8">
                <button className="w-full h-12 bg-[#D4AF37] text-black text-xs font-black uppercase tracking-[3px] rounded-lg shadow-[0_0_20px_rgba(212,175,55,0.15)] hover:bg-[#D4AF37]/80 transition-all leading-none">
                  Draft Intelligence Briefing
                </button>
                <button className="w-full h-12 bg-white/5 border border-white/10 text-white text-xs font-black uppercase tracking-[3px] rounded-lg hover:bg-white/10 transition-all leading-none">
                  Launch Outreach Node
                </button>
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

function Shield(props: any) {
  return (
    <svg {...props} xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="lucide lucide-shield"><path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z"/></svg>
  )
}

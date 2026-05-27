import { Shield, ChevronDown, ChevronUp, Search, Mail, BookOpen } from "lucide-react";
import { Link } from "react-router-dom";
import { useState } from "react";

const FAQ_DATA = [
  {
    k: "What exactly is a 'Lead Signal'?",
    v: "A lead signal is a discrete data point mined from government registries—like IndiaMART queries, MCA incorporations, or UAE trade filings—that indicates potential B2B buying behavior before a formal RFP is issued."
  },
  {
    k: "How are Credits calculated?",
    v: "Each 'credit' represents a successful AI reasoning pass (Gate, Qualify, or Write blocks). Passive monitoring of signals is free; deep AI refinement consumes credits based on your current tier."
  },
  {
    k: "Is the data real-time?",
    v: "Most sources update every 15-60 minutes. High-velocity sources like IndiaMART and GeM are processed in sub-60 second windows via dedicated edge ingestion nodes."
  },
  {
    k: "What is 'Vanish' status?",
    v: "The Vanish protocol ensures complete data purgation. When a tenant is purged, all leads, PII-scrubbed vectors, and cached registry signals are annihilated from secondary and tertiary cold storage as per GDPR/DPDP."
  }
];

export default function Help() {
  const [openIndex, setOpenIndex] = useState<number | null>(0);

  return (
    <div className="min-h-screen bg-[#020813] text-gray-200 py-12 px-6 relative">
      <div className="fixed inset-0 pointer-events-none bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-900/5 via-[#020813] to-black z-0" />
      
      <div className="max-w-4xl mx-auto relative z-10">
        <header className="mb-16">
          <Link to="/" className="flex items-center gap-2 mb-8 opacity-60 hover:opacity-100 transition-opacity">
            <Shield className="w-5 h-5 text-[#00ffca]" strokeWidth={2.5} />
            <span className="text-xs font-black uppercase tracking-widest text-[#00ffca] font-sans">Back to Alpha</span>
          </Link>
          <h1 className="text-4xl font-black uppercase tracking-widest text-white mb-2 font-sans italic">Support & Protocol Docs</h1>
          <p className="text-sm text-white/40 uppercase tracking-[2px]">NetJana.AI Intelligence Layer Helpdesk</p>
        </header>

        <section className="mb-24">
          <div className="relative mb-8">
            <Search className="absolute left-4 top-3.5 w-5 h-5 text-white/20" />
            <input 
              type="text" 
              placeholder="SEARCH PROTOCOLS OR ENTITY TYPES..."
              className="w-full bg-white/5 border border-white/10 rounded-xl py-3 pl-12 pr-4 text-xs font-bold uppercase tracking-widest focus:outline-none focus:border-[#00ffca]/50"
            />
          </div>

          <div className="space-y-4">
             {FAQ_DATA.map((item, idx) => (
               <div key={idx} className="bg-white/5 border border-white/10 rounded-xl overflow-hidden">
                 <button 
                   onClick={() => setOpenIndex(openIndex === idx ? null : idx)}
                   className="w-full px-6 py-5 flex items-center justify-between text-left hover:bg-white/5 transition-colors"
                 >
                   <span className="text-sm font-bold uppercase tracking-wide text-white/80">{item.k}</span>
                   {openIndex === idx ? <ChevronUp className="w-4 h-4 text-[#00ffca]" /> : <ChevronDown className="w-4 h-4 text-white/30" />}
                 </button>
                 {openIndex === idx && (
                   <div className="px-6 pb-6 pt-0 text-sm text-white/40 leading-relaxed max-w-2xl">
                     {item.v}
                   </div>
                 )}
               </div>
             ))}
          </div>
        </section>

        <div className="grid md:grid-cols-2 gap-8">
           <div className="p-8 bg-[#00ffca]/5 border border-[#00ffca]/20 rounded-2xl">
             <BookOpen className="w-8 h-8 text-[#00ffca] mb-6" />
             <h3 className="text-lg font-bold text-white mb-2 uppercase tracking-wide">Developer API</h3>
             <p className="text-xs text-white/40 leading-loose mb-6">Integrate your CRM directly with our intelligence layer via our authenticated REST endpoints and HMAC webhook signatures.</p>
             <Link to="/app/api" className="text-[10px] font-black uppercase tracking-[3px] text-[#00ffca] border-b border-[#00ffca]/30 pb-0.5 hover:border-[#00ffca] transition-all">Explore API Docs</Link>
           </div>
           
           <div className="p-8 bg-white/5 border border-white/10 rounded-2xl">
             <Mail className="w-8 h-8 text-white/30 mb-6" />
             <h3 className="text-lg font-bold text-white mb-2 uppercase tracking-wide">Tier Support</h3>
             <p className="text-xs text-white/40 leading-loose mb-6">Enterprise and Alpha subscribers receive dedicated support via specialized private Slack channels and high-priority ticketing.</p>
             <a href="mailto:support@convospan.com?subject=Protocol%20Failure" className="text-[10px] font-black uppercase tracking-[3px] text-white/40 border-b border-white/10 pb-0.5 hover:text-white transition-all">Submit Protocol Failure</a>
           </div>
        </div>
      </div>
    </div>
  );
}

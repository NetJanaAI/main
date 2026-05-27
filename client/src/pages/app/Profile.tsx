import { UserButton, useUser, useOrganization } from "../../lib/auth";
import { Key, Trash2, Activity } from 'lucide-react';
import { useState, useEffect } from 'react';
import CreditMeter from '../../components/CreditMeter';
import { useAppStore } from '../../store/appStore';
import { api } from '../../lib/api';

export default function Profile() {
  const { user } = useUser();
  const { organization } = useOrganization();
  const { creditUsed, creditLimit, setCredits } = useAppStore();
  const [apiKey, setApiKey] = useState('sk_live_********************************');
  const [showKey, setShowKey] = useState(false);
  const [isRegenerating, setIsRegenerating] = useState(false);

  useEffect(() => {
    fetchCredits();
  }, []);

  const fetchCredits = async () => {
     try {
       const res = await api.get('/api/profile/credits');
       const data = await res.json();
       if (data.limit) {
         setCredits(data.used, data.limit);
       }
     } catch (err) {
       console.error('Fetch credits failed');
     }
  };

  const handleRegenerateKey = async () => {
    if (!window.confirm('WARNING: REGENERATING YOUR PROTOCOL KEY WILL IMMEDIATELY DISCONNECT ALL ACTIVE INTELLIGENCE NODES. PROCEED?')) return;
    setIsRegenerating(true);
    try {
      const res = await api.post('/api/profile/regenerate-key', {});
      const data = await res.json();
      setApiKey(data.apiKey);
      setShowKey(true);
    } catch (err) {
      console.error('Regeneration failed');
    } finally {
      setIsRegenerating(false);
    }
  };

  return (
    <div className="flex flex-col gap-12 animate-fade-in max-w-5xl">
       <header>
          <h1 className="text-3xl font-sans italic text-white tracking-widest uppercase mb-2">Protocol User Profile</h1>
          <p className="text-[10px] text-white/30 font-black uppercase tracking-[3px]">Identity Terminal Verification Status: ACTIVE</p>
       </header>

       <div className="grid lg:grid-cols-12 gap-12">
          {/* Identity & Credits */}
          <div className="lg:col-span-12 space-y-12">
             <section className="bg-white/5 border border-white/5 p-12 rounded-2xl flex flex-col md:flex-row items-center gap-12 relative overflow-hidden backdrop-blur-3xl">
                <div className="absolute top-0 right-0 w-64 h-64 bg-[#00ffca]/5 blur-3xl pointer-events-none -mr-32 -mt-32" />
                <div className="relative z-10">
                   <UserButton appearance={{ elements: { rootBox: "w-32 h-32 rounded-full border-4 border-[#00ffca]/20 overflow-hidden shadow-[0_0_40px_rgba(0,255,202,0.1)] p-0 flex items-center justify-center bg-black/40" } }} />
                </div>
                <div className="flex-1 text-center md:text-left relative z-10 lg:pl-4">
                   <h2 className="text-3xl font-bold text-white uppercase tracking-tight mb-2 leading-none font-sans italic italic-strong">
                     {user?.fullName || 'Registry Node Analyst'}
                   </h2>
                   <div className="flex flex-wrap items-center justify-center md:justify-start gap-4 text-[10px] uppercase font-black tracking-widest text-white/40 mb-6 border-b border-white/5 pb-6">
                      <span className="bg-[#00ffca]/10 text-[#00ffca] px-3 py-1 rounded border border-[#00ffca]/20">Protocol Alpha</span>
                      <span>Verified System Operator</span>
                      <span>·</span>
                      <span className="text-white/60 lowercase tracking-normal">{user?.primaryEmailAddress?.emailAddress}</span>
                   </div>
                   
                   <div className="flex gap-8 items-center pt-2">
                      <div className="flex flex-col">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/20 mb-1">Current Active Cluster</span>
                        <span className="text-xs font-bold text-white uppercase tracking-widest leading-none">{organization?.name || 'Isolated Individual Mode'}</span>
                      </div>
                      <div className="flex flex-col border-l border-white/10 pl-8">
                        <span className="text-[9px] font-black uppercase tracking-widest text-white/20 mb-1">Status Status</span>
                        <span className="text-xs font-bold text-emerald-400 uppercase tracking-widest leading-none flex items-center gap-1.5 animate-pulse">
                           <Activity className="w-3 h-3" /> Synchronized
                        </span>
                      </div>
                   </div>
                </div>
             </section>

             <div className="grid md:grid-cols-2 gap-8">
                <CreditMeter used={creditUsed} limit={creditLimit} />
                
                <section className="bg-white/5 border border-white/5 p-8 rounded-2xl flex flex-col justify-between backdrop-blur-3xl">
                   <div>
                     <div className="flex items-center gap-2 mb-4">
                        <Key className="w-5 h-5 text-[#00ffca]" strokeWidth={2.5} />
                        <h3 className="text-[10px] font-black uppercase tracking-[3px] text-white/60">Registry Access Guard (API Key)</h3>
                     </div>
                     <p className="text-[10px] text-white/30 font-bold uppercase tracking-[2px] leading-relaxed mb-8">
                        Use this key to programmatically ingest registry signals or hook into the Signal Matrix via external outreach automation nodes.
                     </p>
                     
                     <div className="relative group mb-4">
                        <div className="bg-black/80 border border-white/10 rounded-xl py-4 pl-4 pr-32 text-xs font-black font-data text-[#00ffca] tracking-[2px] truncate group-hover:border-[#00ffca]/40 transition-colors cursor-text select-all">
                           {showKey ? apiKey : 'sk_live_********************************'}
                        </div>
                        <div className="absolute right-2 top-2 flex gap-2">
                           <button onClick={() => setShowKey(!showKey)} className="h-10 px-4 bg-white/5 hover:bg-white/10 text-[9px] font-black uppercase tracking-widest text-white rounded transition-all leading-none">{showKey ? 'Hide' : 'Reveal'}</button>
                        </div>
                     </div>
                   </div>

                   <button 
                     onClick={handleRegenerateKey}
                     disabled={isRegenerating}
                     className="h-12 w-full bg-white/5 border border-white/10 text-white/30 text-[9px] font-black uppercase tracking-[3px] rounded-xl hover:bg-red-500/10 hover:text-red-400 hover:border-red-500/20 transition-all leading-none"
                   >
                     {isRegenerating ? 'Initializing Rotation Sequence...' : 'Regenerate Protocol Access Key'}
                   </button>
                </section>
             </div>

             <section className="bg-red-500/[0.02] border border-red-500/10 p-12 rounded-2xl flex flex-col items-center text-center group hover:bg-red-500/[0.05] transition-all">
                <Trash2 className="w-12 h-12 text-red-500/20 group-hover:text-red-500 transition-colors mb-6" />
                <h3 className="text-xl font-bold font-sans text-white uppercase italic italic-strong mb-2 tracking-widest">Initialization of 'Vanish' Protocol</h3>
                <p className="text-[10px] text-white/30 font-bold uppercase tracking-[3px] max-w-sm leading-relaxed mb-8">
                  Executing Vanish will permanently annihilate your entire intelligence history, PII-scrubbed vectors, and active signal registry. This action is final.
                </p>
                <button className="h-12 px-12 border border-red-500/20 text-red-500 text-[10px] font-black uppercase tracking-widest rounded-xl hover:bg-red-500 hover:text-black transition-all leading-none">
                  Execute Vanish
                </button>
             </section>
          </div>
       </div>
    </div>
  );
}

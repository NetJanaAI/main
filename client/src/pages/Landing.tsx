import { SignedIn, SignedOut, SignInButton, UserButton } from "@clerk/clerk-react";
import { Link } from "react-router-dom";
import { 
  Cpu, 
  Zap, 
  Activity,
  Terminal
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useState, useEffect } from "react";

const MOCK_SIGNALS = [
  { id: 1, org: "Reliance Petro", intent: "Solar Infrastructure", score: 92, status: "HOT" },
  { id: 2, org: "Adani Green", intent: "Grid-Scale Storage", score: 88, status: "WARM" },
  { id: 3, org: "Tata Power", intent: "Smart Meters", score: 76, status: "DISCOVERY" },
  { id: 4, org: "JSW Energy", intent: "Hydro-Turbines", score: 95, status: "HOT" },
];

export default function Landing() {
  const [signalIdx, setSignalIdx] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => {
      setSignalIdx((prev) => (prev + 1) % MOCK_SIGNALS.length);
    }, 3000);
    return () => clearInterval(timer);
  }, []);

  return (
    <div className="min-h-screen bg-[#020813] text-gray-200 overflow-x-hidden selection:bg-[#D4AF37]/30 selection:text-white">
      {/* Dynamic Background */}
      <div className="fixed inset-0 pointer-events-none z-0">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_-20%,_#1e293b_0%,_transparent_70%)] opacity-30" />
        <div className="absolute inset-0 bg-[#020813]" />
        <div className="absolute inset-0 opacity-[0.03] bg-[linear-gradient(to_right,#808080_1px,transparent_1px),linear-gradient(to_bottom,#808080_1px,transparent_1px)] bg-[size:40px_40px]" />
      </div>
      
      {/* Premium Navigation */}
      <nav className="relative z-50 flex items-center justify-between px-8 py-4 border-b border-[#00ffca]/20 backdrop-blur-xl bg-black/50 bg-scanlines">
        <div className="flex items-center gap-3 group px-4 py-2 hover:bg-[#00ffca]/10 rounded-sm transition-all duration-300 cursor-pointer border border-transparent hover:border-[#00ffca]/30">
          <div className="relative">
            <Terminal className="w-6 h-6 text-[#00ffca] relative z-10" />
            <div className="absolute inset-0 bg-[#00ffca] blur-md opacity-20 group-hover:opacity-60 transition-opacity" />
          </div>
          <div className="flex flex-col">
            <span className="text-lg font-data font-black uppercase tracking-[0.1em] text-white leading-none glitch-hover">CONVOSPAN [SYS]</span>
            <span className="text-[10px] font-data font-black uppercase tracking-[0.2em] text-[#00ffca] mt-0.5 opacity-90">GLOBAL_INTEL_NET</span>
          </div>
        </div>

        <div className="flex items-center gap-10">
          <div className="hidden md:flex items-center gap-8 font-data">
            {["Protocol", "Nodes", "Security", "Beta", "Metrics"].map((item) => (
              <a key={item} href="#" className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/50 hover:text-[#00ffca] transition-all hover:bg-[#00ffca]/10 px-2 py-1 rounded-sm border border-transparent hover:border-[#00ffca]/30 glitch-hover">{'['}{item}{']'}</a>
            ))}
          </div>
          <div className="h-4 w-px bg-white/10 hidden md:block" />
          <div className="flex items-center gap-6 font-data">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="text-[11px] font-black uppercase tracking-[0.1em] text-white/60 hover:text-[#00ffca] transition-colors glitch-hover">Auth_Node</button>
              </SignInButton>
              <Link to="/app/dashboard" className="px-6 py-2 bg-[#00ffca]/10 border border-[#00ffca]/50 text-[#00ffca] text-[11px] font-black uppercase tracking-[0.2em] rounded-sm shadow-[0_0_10px_rgba(0,255,202,0.2)] hover:bg-[#00ffca] hover:text-black transition-all">
                Initialize_SYS
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/app/dashboard" className="text-[11px] font-black uppercase tracking-[0.1em] text-[#00ffca] hover:bg-[#00ffca]/20 px-3 py-1 rounded-sm border border-[#00ffca]/50 transition-colors">Launch_Terminal</Link>
              <div className="p-0.5 rounded-sm border border-[#00ffca]/20">
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* High-Density Terminal Core */}
      <main className="relative z-10 max-w-[1600px] w-full mx-auto px-4 pt-12 pb-24 grid lg:grid-cols-4 gap-4 items-start">
        
        {/* Sidebar Telemetry */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="col-span-1 border border-white/10 bg-black/40 rounded-sm p-4 space-y-6 bg-scanlines"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-[10px] font-data font-bold text-white/60">SYSTEM_TELEMETRY</span>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#00ffca] animate-pulse shadow-[0_0_8px_rgba(0,255,202,0.8)]" />
              <span className="text-[10px] font-data text-[#00ffca]">SYNC_ACTIVE</span>
            </div>
          </div>

          <div className="space-y-4">
            {[
              { val: "1.4M", label: "INDEXED_NODES" },
              { val: "42ms", label: "avg_packet_latency" },
              { val: "ENCRYPTED", label: "data_sovereignty" },
              { val: "2,041", label: "signals_intercepted" }
            ].map((stat) => (
              <div key={stat.label} className="space-y-1">
                <div className="text-[10px] font-data text-white/40 uppercase">{stat.label}</div>
                <div className="text-xl font-data font-black text-white glitch-hover">{stat.val}</div>
              </div>
            ))}
          </div>

          <div className="pt-6 border-t border-white/10">
            <button className="w-full py-2 bg-[#00ffca]/10 border border-[#00ffca]/30 text-[#00ffca] font-data text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-[#00ffca] hover:text-black transition-all">
              &gt; OVERRIDE_CONFIG
            </button>
          </div>
        </motion.div>

        {/* The Live Terminal: Intercept Matrix Grid */}
        <motion.div
          initial={{ opacity: 0, scale: 0.99 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.8 }}
          className="col-span-3 relative group"
        >
          <div className="absolute -inset-1 bg-[#00ffca]/10 blur-xl opacity-20 pointer-events-none" />
          
          <div className="relative bg-[#02040A] border border-[#00ffca]/30 rounded-sm overflow-hidden flex flex-col h-[600px]">
            {/* Terminal Matrix Header */}
            <div className="px-4 py-3 border-b border-[#00ffca]/30 bg-[#00ffca]/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Terminal className="w-4 h-4 text-[#00ffca]" />
                <span className="text-[11px] font-data font-black tracking-[0.1em] text-[#00ffca] glitch-hover">/NETJANA/INTERCEPT_MATRIX_V2.0</span>
              </div>
              <div className="text-[10px] font-data text-[#ff3366] animate-pulse">
                [ RECORDING_LIVE_STREAM ]
              </div>
            </div>

            {/* Data Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-2 bg-white/5 border-b border-white/10 text-[10px] font-data font-bold uppercase text-white/50 tracking-wider">
              <div className="col-span-1">SYS_ID</div>
              <div className="col-span-4">TARGET_ORGANIZATION</div>
              <div className="col-span-4">DETECTED_INTENT_VECTOR</div>
              <div className="col-span-2 text-right">CONFiDENCE_SCORE</div>
              <div className="col-span-1 text-right">STAT</div>
            </div>

            {/* Signal Feed Array */}
            <div className="flex-1 overflow-hidden flex flex-col justify-start p-2 gap-1 bg-scanlines relative">
              {/* Sweep Line animation */}
              <div className="absolute left-0 right-0 h-[2px] bg-[#00ffca]/50 shadow-[0_0_10px_rgba(0,255,202,1)]" style={{ animation: 'sweep 4s linear infinite' }} />
              <style>{`
                @keyframes sweep {
                  0% { top: 0%; opacity: 0; }
                  10% { opacity: 1; }
                  90% { opacity: 1; }
                  100% { top: 100%; opacity: 0; }
                }
              `}</style>

              <AnimatePresence mode="popLayout">
                {MOCK_SIGNALS.map((sig, i) => (
                  <motion.div
                    key={`${sig.id}-${signalIdx}`}
                    initial={{ opacity: 0, x: -20 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, scale: 0.98 }}
                    className={`grid grid-cols-12 gap-4 px-4 py-3 items-center border-l-2 ${
                      i === 0 ? "border-[#00ffca] bg-[#00ffca]/5" : "border-white/10 bg-transparent opacity-80"
                    } hover:bg-white/5 transition-colors font-data cursor-crosshair`}
                  >
                    <div className="col-span-1 text-[10px] text-white/30">#{sig.id.toString().padStart(4, '0')}</div>
                    <div className={`col-span-4 text-xs font-bold ${i === 0 ? "text-[#00ffca]" : "text-gray-200"} truncate uppercase`}>
                      {sig.org}
                    </div>
                    <div className="col-span-4 text-[10px] text-white/60 truncate">
                      {sig.intent}
                    </div>
                    <div className="col-span-2 text-right">
                      <div className={`text-sm font-bold ${sig.score > 90 ? 'text-[#00ffca]' : 'text-yellow-400'}`}>
                        {sig.score}.00
                      </div>
                    </div>
                    <div className="col-span-1 text-right">
                      <span className={`text-[9px] px-1.5 py-0.5 rounded-sm border ${
                        sig.status === 'HOT' ? 'border-[#ff3366] text-[#ff3366] bg-[#ff3366]/10' : 
                        sig.status === 'WARM' ? 'border-yellow-500 text-yellow-500 bg-yellow-500/10' :
                        'border-white/20 text-white/40'
                      }`}>
                        {sig.status}
                      </span>
                    </div>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Terminal Footer */}
            <div className="px-6 py-2 border-t border-[#00ffca]/30 bg-black flex items-center justify-between font-data">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-none bg-[#00ffca] animate-pulse" />
                  <span className="text-[10px] text-[#00ffca]">[ ONLINE ]</span>
                </div>
                <div className="text-[10px] text-white/40">NODE: DXB_CORE_04</div>
              </div>
              <button className="text-[10px] text-white/60 hover:text-[#00ffca] border border-transparent hover:border-[#00ffca]/30 px-2 py-0.5 glitch-hover transition-colors">
                [X] FORCEPULL_DATA
              </button>
            </div>
          </div>
        </motion.div>
      </main>

      {/* System Features Matrix */}
      <section className="relative z-10 px-4 py-16 grid md:grid-cols-3 gap-4 border-t border-white/10 bg-black/40 font-data">
        {[
          { icon: Zap, label: "LATENCY_ZERO", desc: "Interceptors scan GeM/MCA clusters in < 200ms." },
          { icon: Cpu, label: "ADVERSARIAL_AUDIT", desc: "Multi-agent consensus scoring before terminal display." },
          { icon: Activity, label: "PREDICTIVE_VECTORS", desc: "Intent graphs map funding ahead of RFP publication." },
        ].map((feat) => (
          <div key={feat.label} className="p-6 bg-white/[0.01] border border-white/10 rounded-sm hover:bg-[#00ffca]/5 hover:border-[#00ffca]/30 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 bg-black border border-white/10 rounded-sm flex items-center justify-center mb-4 group-hover:border-[#00ffca]/50 transition-colors">
                <feat.icon className="w-5 h-5 text-white/30 group-hover:text-[#00ffca] transition-colors" />
              </div>
              <h3 className="text-sm font-bold text-[#00ffca] mb-2 glitch-hover">{feat.label}</h3>
            </div>
            <p className="text-[11px] text-white/50 leading-relaxed">
              &gt; {feat.desc}
            </p>
          </div>
        ))}
      </section>

      {/* Global Trust Footer */}
      <footer className="relative z-10 py-20 px-8 border-t border-white/5 flex flex-col items-center gap-8">
        <div className="flex gap-12 opacity-30 grayscale contrast-125">
          {["IndiaMART", "mca.gov.in", "gem.gov.in", "zauba_trade"].map(p => (
            <span key={p} className="text-[10px] font-black uppercase tracking-[4px] text-white underline underline-offset-8 decoration-white/20">{p}</span>
          ))}
        </div>
        <div className="flex flex-col items-center gap-4 text-[9px] font-black uppercase tracking-[3px] text-white/20">
          <div className="flex gap-8">
            <a href="#" className="hover:text-white transition-colors">Protocol_Doc</a>
            <a href="#" className="hover:text-white transition-colors">Privacy_Guard</a>
            <a href="#" className="hover:text-white transition-colors">Compliance</a>
          </div>
          <p>© 2026 CONVOSPAN INTEL — ALL RIGHTS RESERVED SECTOR_01</p>
        </div>
      </footer>
    </div>
  );
}
 bitumen: 121

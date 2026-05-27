import { SignedIn, SignedOut, SignInButton, UserButton } from "../lib/auth";
import { Link } from "react-router-dom";
import {
  Cpu,
  Zap,
  Activity,
  Terminal
} from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { useTranslation } from "react-i18next";
import { useState, useEffect } from "react";
import { api } from "../lib/api";

// DEMO_MODE: These signals are simulated for the unauthenticated landing view.
// In a provisioned environment, this feed is replaced by a live intercept stream.
const DEMO_SIGNALS = [
  { id: 1, org: "Reliance Petro", intent: "Solar Infrastructure", score: 92, status: "HOT" },
  { id: 2, org: "Adani Green", intent: "Grid-Scale Storage", score: 88, status: "WARM" },
  { id: 3, org: "Tata Power", intent: "Smart Meters", score: 76, status: "DISCOVERY" },
  { id: 4, org: "JSW Energy", intent: "Hydro-Turbines", score: 95, status: "HOT" },
];

interface Stats {
  total: number;
  hot: number;
  today: number;
  alpha_sum: number;
}

type LandingLead = {
  id?: number | string;
  lead_id?: number | string;
  org?: string;
  company_name?: string;
  intent?: string;
  procurement_category?: string;
  score?: number;
  intent_score?: number;
  status?: string;
};

export function TerminalExperience() {
  const { t } = useTranslation();
  const [signalIdx, setSignalIdx] = useState(0);
  const [stats, setStats] = useState<Stats>({ total: 2041, hot: 412, today: 121, alpha_sum: 140000 });
  const [liveLeads, setLiveLeads] = useState<LandingLead[]>([]);

  useEffect(() => {
    // 1. Cycle active signal index
    const timer = setInterval(() => {
      setSignalIdx((prev) => (prev + 1) % Math.max(1, liveLeads.length));
    }, 4000);

    // 2. Fetch real stats for the telemetry sidebar
    const fetchStats = async () => {
      try {
        const res = await api.get('/api/leads/stats');
        if (res.ok) {
          const data = await res.json();
          setStats(data);
        }
      } catch {
        console.warn('[Landing] Stats fetch failed, staying in simulated mode.');
      }
    };
    fetchStats();
    const statsTimer = setInterval(fetchStats, 60000); // Refresh every minute

    // 3. Fetch real leads for the matrix
    const fetchLeads = async () => {
      try {
        const res = await api.get('/api/leads/match?limit=5');
        if (res.ok) {
          const data = await res.json();
          if (data.matches && data.matches.length > 0) {
            setLiveLeads(data.matches);
          } else {
            setLiveLeads(DEMO_SIGNALS); // Fallback to demo if DB is clean
          }
        }
      } catch {
        setLiveLeads(DEMO_SIGNALS);
      }
    };
    fetchLeads();

    return () => {
      clearInterval(timer);
      clearInterval(statsTimer);
    };
  }, [liveLeads.length]);

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
            <span className="text-lg font-data font-black uppercase tracking-[0.1em] text-white leading-none glitch-hover">{t("convospan_sys")}</span>
            <span className="text-[10px] font-data font-black uppercase tracking-[0.2em] text-[#00ffca] mt-0.5 opacity-90">{t("global_intel_net")}</span>
          </div>
        </div>

        <div className="flex items-center gap-10">
          <div className="hidden md:flex items-center gap-8 font-data">
            {[
              ["Protocol", "#protocol"],
              ["Nodes", "#nodes"],
              ["Security", "#security"],
              ["Beta", "/setup"],
              ["Metrics", "#metrics"],
            ].map(([item, href]) => (
              <a key={item} href={href} className="text-[11px] font-bold uppercase tracking-[0.1em] text-white/50 hover:text-[#00ffca] transition-all hover:bg-[#00ffca]/10 px-2 py-1 rounded-sm border border-transparent hover:border-[#00ffca]/30 glitch-hover">{'['}{item}{']'}</a>
            ))}
          </div>
          <div className="h-4 w-px bg-white/10 hidden md:block" />
          <div className="flex items-center gap-6 font-data">
            <SignedOut>
              <SignInButton mode="modal">
                <button className="text-[11px] font-black uppercase tracking-[0.1em] text-white/60 hover:text-[#00ffca] transition-colors glitch-hover">{t("auth_node")}</button>
              </SignInButton>
              <Link to="/app/dashboard" className="px-6 py-2 bg-[#00ffca]/10 border border-[#00ffca]/50 text-[#00ffca] text-[11px] font-black uppercase tracking-[0.2em] rounded-sm shadow-[0_0_10px_rgba(0,255,202,0.2)] hover:bg-[#00ffca] hover:text-black transition-all">
                {t("initialize_sys")}
              </Link>
            </SignedOut>
            <SignedIn>
              <Link to="/app/dashboard" className="text-[11px] font-black uppercase tracking-[0.1em] text-[#00ffca] hover:bg-[#00ffca]/20 px-3 py-1 rounded-sm border border-[#00ffca]/50 transition-colors">{t("launch_terminal")}</Link>
              <div className="p-0.5 rounded-sm border border-[#00ffca]/20">
                <UserButton afterSignOutUrl="/" />
              </div>
            </SignedIn>
          </div>
        </div>
      </nav>

      {/* High-Density Terminal Core */}
      <main id="nodes" className="relative z-10 max-w-[1600px] w-full mx-auto px-4 pt-12 pb-24 grid lg:grid-cols-4 gap-4 items-start">

        {/* Sidebar Telemetry */}
        <motion.div
          id="metrics"
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.5, ease: "easeOut" }}
          className="col-span-1 border border-white/10 bg-black/40 rounded-sm p-4 space-y-6 bg-scanlines"
        >
          <div className="flex items-center justify-between border-b border-white/10 pb-2">
            <span className="text-[10px] font-data font-bold text-white/60">{t("system_telemetry")}</span>
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-[#00ffca] animate-pulse shadow-[0_0_8px_rgba(0,255,202,0.8)]" />
              <span className="text-[10px] font-data text-[#00ffca]">{t("sync_active")}</span>
            </div>
          </div>

          <div className="space-y-4">
            {[
              { val: stats.total.toLocaleString(), label: "INDEXED_NODES" },
              { val: "42ms", label: "avg_packet_latency" },
              { val: (stats.alpha_sum / 1000).toFixed(1) + "k", label: "aggregate_alpha" },
              { val: stats.today.toLocaleString(), label: "signals_intercepted_today" }
            ].map((stat) => (
              <div key={stat.label} className="space-y-1">
                <div className="text-[10px] font-data text-white/40 uppercase">{stat.label}</div>
                <div className="text-xl font-data font-black text-white glitch-hover">{stat.val}</div>
              </div>
            ))}
          </div>

          <div className="pt-6 border-t border-white/10">
            <Link to="/setup" className="block text-center w-full py-2 bg-[#00ffca]/10 border border-[#00ffca]/30 text-[#00ffca] font-data text-[10px] font-bold uppercase tracking-[0.1em] hover:bg-[#00ffca] hover:text-black transition-all">
              &gt; OVERRIDE_CONFIG
            </Link>
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
              <div className="text-[10px] font-data text-[#00ffca] animate-pulse">
                [ {liveLeads === DEMO_SIGNALS ? 'DEMO_MODE: SIMULATED_STREAM' : 'LIVE_MODE: REALTIME_INTERCEPT'} ]
              </div>
            </div>

            {/* Data Table Header */}
            <div className="grid grid-cols-12 gap-4 px-6 py-2 bg-white/5 border-b border-white/10 text-[10px] font-data font-bold uppercase text-white/50 tracking-wider">
              <div className="col-span-1">{t("sys_id")}</div>
              <div className="col-span-4">{t("target_organization")}</div>
              <div className="col-span-4">{t("detected_intent_vector")}</div>
              <div className="col-span-2 text-right">{t("confidence_score")}</div>
              <div className="col-span-1 text-right">{t("stat")}</div>
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
                {liveLeads.map((sig, i) => {
                  const signalId = sig.lead_id || sig.id || `sig-${i}`;
                  const score = sig.intent_score ?? sig.score ?? 0;
                  return (
                    <motion.div
                      key={`${signalId}-${signalIdx}`}
                      initial={{ opacity: 0, x: -20 }}
                      animate={{ opacity: 1, x: 0 }}
                      exit={{ opacity: 0, scale: 0.98 }}
                      className={`grid grid-cols-12 gap-4 px-4 py-3 items-center border-l-2 ${
                        i === 0 ? "border-[#00ffca] bg-[#00ffca]/5" : "border-white/10 bg-transparent opacity-80"
                      } hover:bg-white/5 transition-colors font-data cursor-crosshair`}
                    >
                      <div className="col-span-1 text-[10px] text-white/30">#{signalId.toString().substring(0,4)}</div>
                      <div className={`col-span-4 text-xs font-bold ${i === 0 ? "text-[#00ffca]" : "text-gray-200"} truncate uppercase`}>
                        {sig.company_name || sig.org}
                      </div>
                      <div className="col-span-4 text-[10px] text-white/60 truncate">
                        {sig.procurement_category || sig.intent}
                      </div>
                      <div className="col-span-2 text-right">
                        <div className={`text-sm font-bold ${score > 90 ? 'text-[#00ffca]' : 'text-yellow-400'}`}>
                          {score}.00
                        </div>
                      </div>
                      <div className="col-span-1 text-right">
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-sm border ${
                          score >= 80 ? 'border-[#ff3366] text-[#ff3366] bg-[#ff3366]/10' :
                          score >= 60 ? 'border-yellow-500 text-yellow-500 bg-yellow-500/10' :
                          'border-white/20 text-white/40'
                        }`}>
                          {score >= 80 ? 'HOT' : score >= 60 ? 'WARM' : 'COLD'}
                        </span>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>

            {/* Terminal Footer */}
            <div className="px-6 py-2 border-t border-[#00ffca]/30 bg-black flex items-center justify-between font-data">
              <div className="flex items-center gap-6">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-none bg-[#00ffca] animate-pulse" />
                  <span className="text-[10px] text-[#00ffca]">[ ONLINE ]</span>
                </div>
                <div className="text-[10px] text-white/40">{t("node_dxb_core_04")}</div>
              </div>
              <Link to="/app/dashboard" className="text-[10px] text-white/60 hover:text-[#00ffca] border border-transparent hover:border-[#00ffca]/30 px-2 py-0.5 glitch-hover transition-colors">
                [X] FORCEPULL_DATA
              </Link>
            </div>
          </div>
        </motion.div>
      </main>

      {/* System Features Matrix */}
      <section id="protocol" className="relative z-10 px-4 py-16 grid md:grid-cols-3 gap-4 border-t border-white/10 bg-black/40 font-data">
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
      <footer id="security" className="relative z-10 py-20 px-8 border-t border-white/5 flex flex-col items-center gap-8">
        <div className="flex gap-12 opacity-30 grayscale contrast-125">
          {["IndiaMART", "mca.gov.in", "gem.gov.in", "zauba_trade"].map(p => (
            <span key={p} className="text-[10px] font-black uppercase tracking-[4px] text-white underline underline-offset-8 decoration-white/20">{p}</span>
          ))}
        </div>
        <div className="flex flex-col items-center gap-4 text-[9px] font-black uppercase tracking-[3px] text-white/20">
          <div className="flex gap-8">
            <Link to="/help" className="hover:text-white transition-colors">{t("protocol_doc")}</Link>
            <Link to="/help" className="hover:text-white transition-colors">{t("privacy_guard")}</Link>
            <Link to="/help" className="hover:text-white transition-colors">{t("compliance")}</Link>
          </div>
          <p>© 2026 CONVOSPAN INTEL — ALL RIGHTS RESERVED SECTOR_01</p>
        </div>
      </footer>
    </div>
  );
}

const ONBOARDING_COMPLETE_KEY = "netjana_onboarding_complete";

export default function Landing() {
  const isSetupComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true";

  if (isSetupComplete) {
    return <TerminalExperience />;
  }

  return (
    <div className="min-h-screen bg-[#020813] text-white overflow-hidden">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-35"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1451187580459-43490279c0fa?auto=format&fit=crop&w=2400&q=80')",
        }}
      />
      <div className="absolute inset-0 bg-[#020813]/55" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.05)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.05)_1px,transparent_1px)] bg-[size:64px_64px] opacity-30" />

      <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 py-6">
        <Link to="/" className="flex items-center gap-3">
          <Terminal className="w-7 h-7 text-[#00ffca]" />
          <div>
            <div className="text-sm font-black uppercase tracking-[0.25em] text-white">ConvoSpan Intel</div>
            <div className="text-[9px] font-black uppercase tracking-[0.3em] text-[#00ffca]">Buyer Signal OS</div>
          </div>
        </Link>
        <Link
          to="/login"
          className="px-5 py-2 border border-[#00ffca]/40 bg-[#00ffca]/10 text-[#00ffca] text-[10px] font-black uppercase tracking-[0.25em] hover:bg-[#00ffca] hover:text-black transition-all"
        >
          Login
        </Link>
      </nav>

      <main className="relative z-10 min-h-[calc(100vh-96px)] flex items-center px-6 md:px-10 pb-16">
        <section className="max-w-5xl">
          <div className="inline-flex items-center gap-2 border border-[#00ffca]/30 bg-black/30 px-3 py-1 mb-8">
            <div className="w-1.5 h-1.5 bg-[#00ffca] animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#00ffca]">
              Procurement intent before the market sees it
            </span>
          </div>

          <h1 className="text-5xl md:text-7xl lg:text-8xl font-black uppercase tracking-tight leading-[0.9] max-w-5xl">
            Build your private buyer-intent radar.
          </h1>
          <p className="mt-8 max-w-2xl text-base md:text-lg text-white/65 leading-relaxed">
            Configure your industry, watch keywords, and source mix once. ConvoSpan then turns registry activity into a live terminal of qualified B2B demand signals.
          </p>

          <div className="mt-10 flex flex-col sm:flex-row gap-4">
            <Link
              to="/login"
              className="inline-flex items-center justify-center px-8 py-4 bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.25em] hover:bg-white transition-colors"
            >
              Start Setup
            </Link>
            <Link
              to="/help"
              className="inline-flex items-center justify-center px-8 py-4 border border-white/15 bg-white/5 text-white text-xs font-black uppercase tracking-[0.25em] hover:border-white/40 transition-colors"
            >
              View Protocol
            </Link>
          </div>

          <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-3xl">
            {[
              ["Sources", "GeM, MCA, IndiaMART, Zauba"],
              ["Setup", "Industry, regions, keywords"],
              ["Output", "Live lead terminal"],
            ].map(([label, value]) => (
              <div key={label} className="border border-white/10 bg-black/35 px-4 py-3">
                <div className="text-[9px] font-black uppercase tracking-[0.25em] text-white/35">{label}</div>
                <div className="mt-1 text-xs font-bold text-white/80">{value}</div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
}

import { SignedIn, SignedOut, SignInButton, SignUpButton, UserButton } from "../lib/auth";
import { Link } from "react-router-dom";
import {
  Cpu,
  Zap,
  Activity,
  Terminal,
  Bot,
  BarChart3,
  Mail,
  MessageSquare,
  Linkedin,
  Radio,
  ShieldCheck,
  ArrowRight,
  Send
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
    <div className="min-h-screen bg-[#020813] text-gray-200 overflow-x-hidden selection:bg-[#00ffca]/30 selection:text-white">
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
              <SignUpButton mode="modal">
                <button className="px-6 py-2 bg-[#00ffca]/10 border border-[#00ffca]/50 text-[#00ffca] text-[11px] font-black uppercase tracking-[0.2em] rounded-sm shadow-[0_0_10px_rgba(0,255,202,0.2)] hover:bg-[#00ffca] hover:text-black transition-all">
                  {t("initialize_sys")}
                </button>
              </SignUpButton>
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
          <p>© 2026 NET JANA AI — ALL RIGHTS RESERVED SECTOR_01</p>
        </div>
      </footer>
    </div>
  );
}

const ONBOARDING_COMPLETE_KEY = "netjana_onboarding_complete";

function ProductDashboardPreview() {
  const floatingCards = [
    {
      className: "top-8 -left-8 md:-left-12",
      icon: Bot,
      label: "AI Agent Activity",
      value: "14 active",
      detail: "Qualifier -> Writer -> Outreach",
      delay: 0.15,
    },
    {
      className: "top-20 -right-4 md:-right-10",
      icon: BarChart3,
      label: "Response Rate",
      value: "31.8%",
      detail: "+8.4% this week",
      delay: 0.3,
    },
    {
      className: "bottom-24 -left-4 md:-left-14",
      icon: Send,
      label: "Outreach Performance",
      value: "2.4k sent",
      detail: "Email, LinkedIn, WABA",
      delay: 0.45,
    },
    {
      className: "bottom-8 -right-3 md:-right-12",
      icon: Radio,
      label: "Campaign Metrics",
      value: "86 AQ",
      detail: "4 high-intent accounts",
      delay: 0.6,
    },
  ];

  return (
    <div className="relative w-full max-w-[720px] mx-auto lg:mr-0 perspective-[1400px]">
      <motion.div
        initial={{ opacity: 0, y: 36, rotateX: 4, rotateY: -6 }}
        animate={{ opacity: 1, y: 0, rotateX: 0, rotateY: -4 }}
        whileHover={{ y: -8, rotateY: -2, rotateX: 1 }}
        transition={{ duration: 0.8, ease: [0.16, 1, 0.3, 1] }}
        className="relative rounded-[22px] border border-[#00ffca]/20 bg-[#03101a]/78 shadow-[0_32px_90px_rgba(0,0,0,0.5),0_0_50px_rgba(0,255,202,0.08)] backdrop-blur-2xl overflow-hidden"
      >
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_20%_0%,rgba(0,255,202,0.18),transparent_32%),linear-gradient(135deg,rgba(255,255,255,0.08),transparent_35%)] pointer-events-none" />
        <div className="relative border-b border-white/10 px-5 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl border border-[#00ffca]/30 bg-[#00ffca]/10 flex items-center justify-center">
              <Terminal className="h-4 w-4 text-[#00ffca]" />
            </div>
            <div>
              <div className="text-[10px] font-black uppercase tracking-[0.28em] text-white/45">Net Jana AI Command</div>
              <div className="text-sm font-black uppercase tracking-[0.16em] text-white">Outreach Orchestration</div>
            </div>
          </div>
          <div className="hidden sm:flex items-center gap-2 rounded-full border border-emerald-400/20 bg-emerald-400/10 px-3 py-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.9)]" />
            <span className="text-[9px] font-black uppercase tracking-[0.2em] text-emerald-300">Live Agents</span>
          </div>
        </div>

        <div className="relative grid lg:grid-cols-12 gap-0 min-h-[420px]">
          <aside className="hidden lg:block lg:col-span-3 border-r border-white/10 bg-black/20 p-4 space-y-3">
            {["Signal Intake", "Agent Chain", "Campaigns", "Analytics"].map((item, idx) => (
              <div
                key={item}
                className={`rounded-xl px-3 py-3 border text-[10px] font-black uppercase tracking-[0.16em] transition-colors ${
                  idx === 1
                    ? "border-[#00ffca]/30 bg-[#00ffca]/10 text-[#00ffca]"
                    : "border-white/5 bg-white/[0.03] text-white/35"
                }`}
              >
                {item}
              </div>
            ))}
          </aside>

          <main className="lg:col-span-9 p-5 md:p-6 space-y-5">
            <div className="grid grid-cols-3 gap-3">
              {[
                ["Qualified Leads", "1,284", "+18%"],
                ["Sequences Live", "42", "8 agents"],
                ["Pipeline Value", "$8.7M", "+24%"],
              ].map(([label, value, trend]) => (
                <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.045] p-4">
                  <div className="text-[8px] font-black uppercase tracking-[0.22em] text-white/35">{label}</div>
                  <div className="mt-3 text-xl md:text-2xl font-black tracking-tight text-white">{value}</div>
                  <div className="mt-1 text-[9px] font-black uppercase tracking-[0.16em] text-[#00ffca]">{trend}</div>
                </div>
              ))}
            </div>

            <div className="grid md:grid-cols-12 gap-4">
              <section className="md:col-span-7 rounded-2xl border border-white/10 bg-black/28 p-4">
                <div className="flex items-center justify-between mb-5">
                  <div>
                    <div className="text-[9px] font-black uppercase tracking-[0.24em] text-[#00ffca]">Agent Workflow</div>
                    <div className="mt-1 text-sm font-bold text-white/85">Procurement signal to booked meeting</div>
                  </div>
                  <Bot className="h-5 w-5 text-[#00ffca]" />
                </div>
                <div className="space-y-3">
                  {[
                    ["Gate Agent", "Classified 217 buyer signals", "complete"],
                    ["Qualifier", "Scoring buying stage and pain", "active"],
                    ["Lead Writer", "Drafting account-specific hooks", "active"],
                    ["Outreach Dispatcher", "Queuing multi-channel sequence", "queued"],
                  ].map(([name, detail, state]) => (
                    <div key={name} className="flex items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.035] p-3">
                      <div className={`h-2.5 w-2.5 rounded-full ${state === "complete" ? "bg-emerald-400" : state === "active" ? "bg-[#00ffca] animate-pulse" : "bg-white/25"}`} />
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-black uppercase tracking-[0.14em] text-white">{name}</div>
                        <div className="text-[10px] text-white/42 truncate">{detail}</div>
                      </div>
                      <div className="text-[8px] font-black uppercase tracking-[0.16em] text-white/30">{state}</div>
                    </div>
                  ))}
                </div>
              </section>

              <section className="md:col-span-5 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                <div className="flex items-center justify-between mb-5">
                  <div className="text-[9px] font-black uppercase tracking-[0.22em] text-white/40">Channel Distribution</div>
                  <ShieldCheck className="h-4 w-4 text-[#00ffca]" />
                </div>
                <div className="space-y-4">
                  {[
                    ["Email", "48%", Mail],
                    ["LinkedIn", "31%", Linkedin],
                    ["WABA", "21%", MessageSquare],
                  ].map(([channel, value, Icon]) => (
                    <div key={channel as string}>
                      <div className="flex justify-between items-center text-[10px] font-black uppercase tracking-[0.16em] text-white/60">
                        <span className="flex items-center gap-2"><Icon className="h-3.5 w-3.5 text-[#00ffca]" />{channel as string}</span>
                        <span>{value as string}</span>
                      </div>
                      <div className="mt-2 h-1.5 rounded-full bg-white/[0.08] overflow-hidden">
                        <div className="h-full rounded-full bg-[#00ffca]" style={{ width: value as string }} />
                      </div>
                    </div>
                  ))}
                </div>
                <div className="mt-6 rounded-xl border border-[#00ffca]/20 bg-[#00ffca]/10 p-3">
                  <div className="text-[9px] font-black uppercase tracking-[0.18em] text-[#00ffca]">Next best action</div>
                  <div className="mt-2 text-xs text-white/75 leading-relaxed">Prioritize LinkedIn follow-up for 9 high-verity accounts.</div>
                </div>
              </section>
            </div>
          </main>
        </div>
      </motion.div>

      {floatingCards.map(({ icon: Icon, className, label, value, detail, delay }) => (
        <motion.div
          key={label}
          initial={{ opacity: 0, y: 18, scale: 0.96 }}
          animate={{ opacity: 1, y: [0, -7, 0], scale: 1 }}
          transition={{ opacity: { duration: 0.5, delay }, y: { duration: 5 + delay, repeat: Infinity, ease: "easeInOut" }, scale: { duration: 0.5, delay } }}
          className={`hidden md:block absolute ${className} w-52 rounded-2xl border border-white/[0.12] bg-[#061622]/[0.82] p-4 backdrop-blur-2xl shadow-[0_18px_55px_rgba(0,0,0,0.36)]`}
        >
          <div className="flex items-center gap-3">
            <div className="h-9 w-9 rounded-xl bg-[#00ffca]/10 border border-[#00ffca]/25 flex items-center justify-center">
              <Icon className="h-4 w-4 text-[#00ffca]" />
            </div>
            <div>
              <div className="text-[8px] font-black uppercase tracking-[0.18em] text-white/35">{label}</div>
              <div className="text-lg font-black text-white">{value}</div>
            </div>
          </div>
          <div className="mt-3 text-[10px] text-white/45">{detail}</div>
        </motion.div>
      ))}
    </div>
  );
}

export default function Landing() {
  const isSetupComplete = localStorage.getItem(ONBOARDING_COMPLETE_KEY) === "true";

  if (isSetupComplete) {
    return <TerminalExperience />;
  }

  return (
    <div className="min-h-screen bg-[#020813] text-white overflow-hidden font-sans">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_70%_18%,rgba(0,255,202,0.14),transparent_32%),radial-gradient(circle_at_12%_22%,rgba(34,211,238,0.08),transparent_28%),linear-gradient(180deg,#020813_0%,#02040A_100%)]" />
      <div className="absolute inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:72px_72px] opacity-30" />

      <nav className="relative z-10 flex items-center justify-between px-6 md:px-10 py-6">
        <Link to="/" className="flex items-center gap-3">
          <Terminal className="w-7 h-7 text-[#00ffca]" />
          <div>
            <div className="text-sm font-black uppercase tracking-[0.25em] text-white">Net Jana AI</div>
            <div className="text-[9px] font-black uppercase tracking-[0.3em] text-[#00ffca]">Buyer Signal OS</div>
          </div>
        </Link>
        <div className="flex items-center gap-3">
          <SignedOut>
            <SignInButton mode="modal">
              <button className="px-5 py-2 border border-white/15 bg-white/5 text-white text-[10px] font-black uppercase tracking-[0.25em] hover:border-[#00ffca]/50 hover:text-[#00ffca] transition-all">
                Sign in
              </button>
            </SignInButton>
            <SignUpButton mode="modal">
              <button className="px-5 py-2 border border-[#00ffca]/40 bg-[#00ffca]/10 text-[#00ffca] text-[10px] font-black uppercase tracking-[0.25em] hover:bg-[#00ffca] hover:text-black transition-all">
                Sign up
              </button>
            </SignUpButton>
          </SignedOut>
          <SignedIn>
            <Link
              to="/setup"
              className="px-5 py-2 border border-[#00ffca]/40 bg-[#00ffca]/10 text-[#00ffca] text-[10px] font-black uppercase tracking-[0.25em] hover:bg-[#00ffca] hover:text-black transition-all"
            >
              Setup
            </Link>
            <UserButton afterSignOutUrl="/" />
          </SignedIn>
        </div>
      </nav>

      <main className="relative z-10 min-h-[calc(100vh-96px)] px-6 md:px-10 pt-8 lg:pt-0 pb-16 flex items-start lg:items-center">
        <section className="w-full max-w-[1500px] mx-auto grid lg:grid-cols-[0.9fr_1.1fr] gap-8 lg:gap-12 xl:gap-20 items-center">
          <motion.div
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.65, ease: "easeOut" }}
            className="max-w-2xl"
          >
          <div className="inline-flex items-center gap-2 border border-[#00ffca]/30 bg-black/30 px-3 py-1 mb-5 md:mb-8 rounded-full">
            <div className="w-1.5 h-1.5 bg-[#00ffca] animate-pulse" />
            <span className="text-[10px] font-black uppercase tracking-[0.25em] text-[#00ffca]">
              AI outreach orchestration for revenue teams
            </span>
          </div>

          <h1 className="text-4xl sm:text-5xl md:text-6xl xl:text-7xl font-black uppercase tracking-tight leading-[0.92]">
            Turn buyer intent into coordinated outreach.
          </h1>
          <p className="mt-5 md:mt-8 text-sm md:text-lg text-white/65 leading-relaxed">
            Net Jana AI coordinates AI agents, live signal intelligence, multi-channel execution, and performance analytics in one operating layer for outbound teams.
          </p>

          <div className="mt-7 md:mt-10 flex flex-col sm:flex-row gap-3 md:gap-4">
            <SignedOut>
              <SignUpButton mode="modal">
                <button className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.22em] rounded-xl hover:bg-white transition-colors shadow-[0_0_30px_rgba(0,255,202,0.16)]">
                  Start Setup <ArrowRight className="h-4 w-4" />
                </button>
              </SignUpButton>
            </SignedOut>
            <SignedIn>
              <Link
                to="/setup"
                className="inline-flex items-center justify-center gap-2 px-8 py-4 bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.22em] rounded-xl hover:bg-white transition-colors shadow-[0_0_30px_rgba(0,255,202,0.16)]"
              >
                Start Setup <ArrowRight className="h-4 w-4" />
              </Link>
            </SignedIn>
            <Link
              to="/help"
              className="inline-flex items-center justify-center px-8 py-4 border border-white/15 bg-white/5 text-white text-xs font-black uppercase tracking-[0.22em] rounded-xl hover:border-[#00ffca]/50 hover:text-[#00ffca] transition-colors"
            >
              View Protocol
            </Link>
          </div>

          <div className="hidden sm:grid mt-10 md:mt-12 grid-cols-1 sm:grid-cols-3 gap-3">
            {[
              ["Agents", "Gate, qualify, write, dispatch"],
              ["Channels", "Email, LinkedIn, WABA"],
              ["Analytics", "Pipeline, reply, conversion"],
            ].map(([label, value]) => (
              <div key={label} className="border border-white/10 bg-black/35 px-4 py-3 rounded-2xl backdrop-blur-md">
                <div className="text-[9px] font-black uppercase tracking-[0.25em] text-white/35">{label}</div>
                <div className="mt-1 text-xs font-bold text-white/80">{value}</div>
              </div>
            ))}
          </div>

          <div className="hidden md:flex mt-8 flex-wrap items-center gap-x-6 gap-y-3 text-[10px] font-black uppercase tracking-[0.18em] text-white/35">
            <span className="flex items-center gap-2"><ShieldCheck className="h-3.5 w-3.5 text-[#00ffca]" /> HMAC verified</span>
            <span className="flex items-center gap-2"><Activity className="h-3.5 w-3.5 text-[#00ffca]" /> Live agent telemetry</span>
            <span className="flex items-center gap-2"><Radio className="h-3.5 w-3.5 text-[#00ffca]" /> Multi-source signals</span>
          </div>
          </motion.div>

          <ProductDashboardPreview />
        </section>
      </main>
    </div>
  );
}

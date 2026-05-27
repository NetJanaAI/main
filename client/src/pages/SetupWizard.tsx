import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Database,
  Globe2,
  Loader2,
  Search,
  ShieldCheck,
  Sparkles,
  Target,
} from "lucide-react";
import { api } from "../lib/api";

const ONBOARDING_COMPLETE_KEY = "netjana_onboarding_complete";
const ONBOARDING_PROFILE_KEY = "netjana_onboarding_profile";

const SOURCE_OPTIONS = [
  { id: "indiamart", label: "Buyer Enquiries", provider: "IndiaMART", note: "Companies actively asking suppliers for quotes." },
  { id: "gem", label: "Government Tenders", provider: "GeM", note: "Public procurement notices and bid opportunities." },
  { id: "mca", label: "Company Filings", provider: "MCA", note: "Business registration and corporate change signals." },
  { id: "zauba", label: "Trade Shipments", provider: "Zauba", note: "Import and export activity that suggests demand." },
  { id: "funding", label: "Funding Events", provider: "Capital news", note: "Freshly funded companies with new budget." },
  { id: "naukri", label: "Hiring Signals", provider: "Naukri", note: "Job posts that reveal tools, projects, and expansion." },
];

const INDUSTRY_PRESETS = [
  "B2B SaaS",
  "IT Services",
  "Manufacturing",
  "Logistics",
  "Renewable Energy",
  "Industrial Equipment",
];

const GOAL_OPTIONS = [
  "Find companies ready to buy",
  "Prioritize tenders and procurement signals",
  "Generate personalized outreach",
  "Track campaign performance",
];

const STEPS = [
  { label: "Business", title: "Your business", icon: Globe2 },
  { label: "Targets", title: "Target buyers", icon: Target },
  { label: "Sources", title: "Signal sources", icon: Database },
  { label: "Launch", title: "Review setup", icon: Sparkles },
];

type SetupForm = {
  company: string;
  industry: string;
  goals: string[];
  keywords: string;
  regions: string;
  minAmount: string;
  sources: string[];
};

function splitList(value: string) {
  return value
    .split(",")
    .map(item => item.trim())
    .filter(Boolean);
}

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [form, setForm] = useState<SetupForm>({
    company: "",
    industry: "",
    goals: ["Find companies ready to buy", "Generate personalized outreach"],
    keywords: "automation, CRM, cloud migration",
    regions: "India, UAE",
    minAmount: "0",
    sources: SOURCE_OPTIONS.map(source => source.id),
  });

  const keywords = useMemo(() => splitList(form.keywords), [form.keywords]);
  const regions = useMemo(() => splitList(form.regions), [form.regions]);
  const selectedSources = SOURCE_OPTIONS.filter(source => form.sources.includes(source.id));

  const validationMessage = useMemo(() => {
    if (step === 0 && !form.company.trim()) return "Add your company name to continue.";
    if (step === 0 && !form.industry.trim()) return "Choose or enter the industry you sell into.";
    if (step === 1 && keywords.length === 0) return "Add at least one buyer keyword.";
    if (step === 1 && regions.length === 0) return "Add at least one target region.";
    if (step === 2 && form.sources.length === 0) return "Choose at least one intelligence source.";
    return null;
  }, [form.company, form.industry, form.sources.length, keywords.length, regions.length, step]);

  const updateForm = (patch: Partial<SetupForm>) => {
    setForm(current => ({ ...current, ...patch }));
    setWarning(null);
  };

  const toggleGoal = (goal: string) => {
    updateForm({
      goals: form.goals.includes(goal)
        ? form.goals.filter(item => item !== goal)
        : [...form.goals, goal],
    });
  };

  const toggleSource = (sourceId: string) => {
    updateForm({
      sources: form.sources.includes(sourceId)
        ? form.sources.filter(id => id !== sourceId)
        : [...form.sources, sourceId],
    });
  };

  const goNext = () => {
    if (validationMessage) {
      setWarning(validationMessage);
      return;
    }
    setWarning(null);
    setStep(current => Math.min(STEPS.length - 1, current + 1));
  };

  const finishSetup = async () => {
    if (validationMessage) {
      setWarning(validationMessage);
      return;
    }

    setSaving(true);
    setWarning(null);

    const profile = {
      company: form.company.trim(),
      industry: form.industry.trim(),
      goals: form.goals,
      keywords,
      regions,
      minimumOpportunityValue: Number(form.minAmount) || 0,
      sources: form.sources,
      sourceLabels: selectedSources.map(source => source.label),
      completedAt: new Date().toISOString(),
    };

    const syncResults = await Promise.allSettled([
      ...SOURCE_OPTIONS.map(source =>
        api.post("/api/sources/toggle", {
          sourceId: source.id,
          enabled: form.sources.includes(source.id),
        })
      ),
      api.post("/api/watch-profiles", {
        name: `${profile.company || "Default"} buyer watchlist`,
        industry: profile.industry,
        goals: profile.goals,
        keywords,
        regions,
        min_amount: profile.minimumOpportunityValue,
        sources: profile.sources,
      }),
    ]);

    localStorage.setItem(ONBOARDING_PROFILE_KEY, JSON.stringify(profile));
    localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
    setSaving(false);

    if (syncResults.some(result => result.status === "rejected")) {
      setWarning("Setup is saved locally. Some backend sync calls failed, so the app will use your saved settings until the API is ready.");
      window.setTimeout(() => navigate("/app/dashboard"), 900);
      return;
    }

    navigate("/app/dashboard");
  };

  const ActiveIcon = STEPS[step].icon;

  return (
    <div className="min-h-screen bg-[#020813] text-white overflow-hidden font-sans">
      <div className="fixed inset-0 bg-[radial-gradient(circle_at_72%_12%,rgba(0,255,202,0.14),transparent_34%),radial-gradient(circle_at_12%_20%,rgba(34,211,238,0.08),transparent_30%),linear-gradient(180deg,#020813_0%,#02040A_100%)]" />
      <div className="fixed inset-0 bg-[linear-gradient(to_right,rgba(255,255,255,0.045)_1px,transparent_1px),linear-gradient(to_bottom,rgba(255,255,255,0.045)_1px,transparent_1px)] bg-[size:72px_72px] opacity-25" />

      <main className="relative z-10 max-w-7xl mx-auto px-6 py-8 md:py-10">
        <header className="flex flex-col gap-6 lg:flex-row lg:items-center lg:justify-between mb-8 md:mb-12">
          <div>
            <Link to="/" className="inline-flex items-center gap-2 text-white/45 hover:text-[#00ffca] transition-colors text-xs font-black uppercase tracking-[0.2em] mb-6">
              <ArrowLeft className="h-4 w-4" />
              Back to home
            </Link>
            <div className="inline-flex items-center gap-2 rounded-full border border-[#00ffca]/30 bg-[#00ffca]/10 px-3 py-1 text-[10px] font-black uppercase tracking-[0.25em] text-[#00ffca]">
              <ActiveIcon className="h-3.5 w-3.5" />
              Setup wizard
            </div>
            <h1 className="mt-5 text-4xl md:text-6xl font-black uppercase tracking-tight leading-[0.94]">
              Set up your outreach command center.
            </h1>
            <p className="mt-5 max-w-2xl text-sm md:text-base text-white/60 leading-relaxed">
              We will use these answers to find the right buyer signals, prioritize useful opportunities, and prepare outreach that is easy for your team to understand.
            </p>
          </div>

          <div className="grid grid-cols-4 gap-2 lg:w-[520px]">
            {STEPS.map((item, index) => {
              const Icon = item.icon;
              const isActive = index === step;
              const isDone = index < step;
              return (
                <button
                  key={item.label}
                  type="button"
                  onClick={() => index < step && setStep(index)}
                  className={`rounded-2xl border px-3 py-4 text-left transition-all ${
                    isActive
                      ? "border-[#00ffca]/60 bg-[#00ffca]/10"
                      : isDone
                        ? "border-emerald-400/30 bg-emerald-400/10"
                        : "border-white/10 bg-white/[0.03]"
                  }`}
                >
                  <Icon className={`h-4 w-4 ${isActive || isDone ? "text-[#00ffca]" : "text-white/35"}`} />
                  <div className="mt-3 text-[9px] font-black uppercase tracking-[0.18em] text-white/35">Step {index + 1}</div>
                  <div className="mt-1 text-xs font-black text-white">{item.label}</div>
                </button>
              );
            })}
          </div>
        </header>

        <section className="grid lg:grid-cols-[1fr_360px] gap-6 items-start">
          <div className="rounded-[24px] border border-white/10 bg-black/40 backdrop-blur-2xl shadow-[0_30px_90px_rgba(0,0,0,0.35)] overflow-hidden">
            <div className="border-b border-white/10 px-6 py-5 flex items-center justify-between">
              <div>
                <div className="text-[10px] font-black uppercase tracking-[0.26em] text-[#00ffca]">{STEPS[step].title}</div>
                <div className="mt-1 text-sm text-white/45">Plain-language setup for your first workspace.</div>
              </div>
              <div className="hidden sm:flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[9px] font-black uppercase tracking-[0.18em] text-white/45">
                <ShieldCheck className="h-3.5 w-3.5 text-[#00ffca]" />
                Saved locally
              </div>
            </div>

            <div className="p-6 md:p-8">
              {step === 0 && (
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <Globe2 className="w-8 h-8 text-[#00ffca] mb-5" />
                    <h2 className="text-2xl font-black tracking-tight">Tell us what you sell.</h2>
                    <p className="mt-3 text-sm text-white/55 leading-relaxed">
                      This helps the agents describe your offer clearly when they score leads and prepare outreach.
                    </p>
                  </div>
                  <div className="space-y-5">
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Company name</span>
                      <input
                        value={form.company}
                        onChange={event => updateForm({ company: event.target.value })}
                        placeholder="ConvoSpan Technologies"
                        className="mt-2 w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                      />
                    </label>

                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Industry or market</span>
                      <input
                        value={form.industry}
                        onChange={event => updateForm({ industry: event.target.value })}
                        placeholder="B2B SaaS, IT services, manufacturing..."
                        className="mt-2 w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                      />
                    </label>

                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40 mb-3">Quick choices</div>
                      <div className="flex flex-wrap gap-2">
                        {INDUSTRY_PRESETS.map(industry => (
                          <button
                            key={industry}
                            type="button"
                            onClick={() => updateForm({ industry })}
                            className={`rounded-full border px-3 py-2 text-[10px] font-black uppercase tracking-[0.14em] transition-colors ${
                              form.industry === industry ? "border-[#00ffca]/60 bg-[#00ffca]/10 text-[#00ffca]" : "border-white/10 bg-white/[0.03] text-white/45 hover:text-white"
                            }`}
                          >
                            {industry}
                          </button>
                        ))}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 1 && (
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <Search className="w-8 h-8 text-[#00ffca] mb-5" />
                    <h2 className="text-2xl font-black tracking-tight">Define the buyers you want.</h2>
                    <p className="mt-3 text-sm text-white/55 leading-relaxed">
                      Use everyday words. The system turns them into watch profiles for tenders, filings, hiring, and inbound enquiries.
                    </p>
                  </div>
                  <div className="space-y-5">
                    <label className="block">
                      <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Buyer keywords</span>
                      <textarea
                        value={form.keywords}
                        onChange={event => updateForm({ keywords: event.target.value })}
                        rows={4}
                        placeholder="automation, CRM, cloud migration"
                        className="mt-2 w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                      />
                      <p className="mt-2 text-xs text-white/35">Separate keywords with commas.</p>
                    </label>

                    <div className="grid sm:grid-cols-2 gap-4">
                      <label className="block">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Target regions</span>
                        <input
                          value={form.regions}
                          onChange={event => updateForm({ regions: event.target.value })}
                          placeholder="India, UAE"
                          className="mt-2 w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                        />
                      </label>
                      <label className="block">
                        <span className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40">Minimum deal value</span>
                        <input
                          type="number"
                          min="0"
                          value={form.minAmount}
                          onChange={event => updateForm({ minAmount: event.target.value })}
                          className="mt-2 w-full rounded-xl bg-white/[0.04] border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                        />
                      </label>
                    </div>

                    <div>
                      <div className="text-[10px] font-black uppercase tracking-[0.22em] text-white/40 mb-3">What should ConvoSpan optimize for?</div>
                      <div className="grid gap-2">
                        {GOAL_OPTIONS.map(goal => {
                          const selected = form.goals.includes(goal);
                          return (
                            <button
                              key={goal}
                              type="button"
                              onClick={() => toggleGoal(goal)}
                              className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left text-sm transition-colors ${
                                selected ? "border-[#00ffca]/50 bg-[#00ffca]/10 text-white" : "border-white/10 bg-white/[0.03] text-white/55 hover:text-white"
                              }`}
                            >
                              {goal}
                              {selected && <Check className="w-4 h-4 text-[#00ffca]" />}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {step === 2 && (
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <Database className="w-8 h-8 text-[#00ffca] mb-5" />
                    <h2 className="text-2xl font-black tracking-tight">Choose where signals come from.</h2>
                    <p className="mt-3 text-sm text-white/55 leading-relaxed">
                      These names describe the business value first. Provider details stay visible, but the feature names are easier for teams to understand.
                    </p>
                  </div>
                  <div className="grid sm:grid-cols-2 gap-3">
                    {SOURCE_OPTIONS.map(source => {
                      const selected = form.sources.includes(source.id);
                      return (
                        <button
                          key={source.id}
                          type="button"
                          onClick={() => toggleSource(source.id)}
                          className={`text-left rounded-2xl border px-4 py-4 transition-all ${
                            selected ? "border-[#00ffca]/60 bg-[#00ffca]/10" : "border-white/10 bg-white/[0.03] hover:bg-white/[0.06]"
                          }`}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <span className="block text-sm font-black text-white">{source.label}</span>
                              <span className="mt-1 block text-[10px] font-black uppercase tracking-[0.18em] text-[#00ffca]/70">{source.provider}</span>
                            </div>
                            {selected && <CheckCircle2 className="w-4 h-4 text-[#00ffca] shrink-0" />}
                          </div>
                          <p className="mt-3 text-xs text-white/45 leading-relaxed">{source.note}</p>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {step === 3 && (
                <div className="grid md:grid-cols-2 gap-8">
                  <div>
                    <Sparkles className="w-8 h-8 text-[#00ffca] mb-5" />
                    <h2 className="text-2xl font-black tracking-tight">Review and launch.</h2>
                    <p className="mt-3 text-sm text-white/55 leading-relaxed">
                      This creates your first buyer watchlist and turns on the selected signal sources. If the backend is offline, your settings are still saved locally.
                    </p>
                  </div>
                  <div className="space-y-3">
                    {[
                      ["Company", form.company || "Not set"],
                      ["Industry", form.industry || "Not set"],
                      ["Buyer keywords", keywords.join(", ") || "Not set"],
                      ["Regions", regions.join(", ") || "Not set"],
                      ["Signal sources", selectedSources.map(source => source.label).join(", ") || "Not set"],
                    ].map(([label, value]) => (
                      <div key={label} className="rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3">
                        <div className="text-[9px] font-black uppercase tracking-[0.22em] text-white/35">{label}</div>
                        <div className="mt-1 text-sm text-white/80 leading-relaxed">{value}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {warning && (
                <div className="mt-8 rounded-2xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
                  {warning}
                </div>
              )}

              <footer className="mt-10 flex items-center justify-between border-t border-white/10 pt-6">
                <button
                  type="button"
                  onClick={() => {
                    setWarning(null);
                    setStep(current => Math.max(0, current - 1));
                  }}
                  disabled={step === 0 || saving}
                  className="px-5 py-3 rounded-xl border border-white/10 text-xs font-black uppercase tracking-[0.18em] text-white/50 disabled:opacity-30 hover:text-white transition-colors"
                >
                  Back
                </button>
                {step < STEPS.length - 1 ? (
                  <button
                    type="button"
                    onClick={goNext}
                    className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.18em] hover:bg-white transition-colors"
                  >
                    Continue <ArrowRight className="w-4 h-4" />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={finishSetup}
                    disabled={saving}
                    className="inline-flex items-center gap-2 px-7 py-3 rounded-xl bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.18em] hover:bg-white disabled:opacity-60 transition-colors"
                  >
                    {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                    {saving ? "Saving setup" : "Launch dashboard"}
                  </button>
                )}
              </footer>
            </div>
          </div>

          <aside className="rounded-[24px] border border-white/10 bg-white/[0.035] backdrop-blur-2xl p-5 lg:sticky lg:top-8">
            <div className="text-[10px] font-black uppercase tracking-[0.24em] text-[#00ffca]">Setup summary</div>
            <div className="mt-5 space-y-4">
              {[
                ["Workspace", form.company || "Company not set"],
                ["Market", form.industry || "Industry not set"],
                ["Keywords", `${keywords.length} keyword${keywords.length === 1 ? "" : "s"}`],
                ["Regions", regions.join(", ") || "No regions"],
                ["Sources", `${selectedSources.length} enabled`],
              ].map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-white/10 pb-4 last:border-b-0 last:pb-0">
                  <span className="text-xs text-white/40">{label}</span>
                  <span className="text-right text-xs font-bold text-white/80">{value}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 rounded-2xl border border-[#00ffca]/20 bg-[#00ffca]/10 p-4">
              <div className="text-[10px] font-black uppercase tracking-[0.2em] text-[#00ffca]">What happens next</div>
              <p className="mt-3 text-xs text-white/60 leading-relaxed">
                ConvoSpan creates a buyer watchlist, enables the selected sources, and opens your dashboard with the same settings saved in this browser.
              </p>
            </div>
          </aside>
        </section>
      </main>
    </div>
  );
}

import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, Database, Globe2, Search, Sparkles } from "lucide-react";
import { api } from "../lib/api";

const ONBOARDING_COMPLETE_KEY = "netjana_onboarding_complete";
const ONBOARDING_PROFILE_KEY = "netjana_onboarding_profile";

const SOURCE_OPTIONS = [
  { id: "indiamart", label: "IndiaMART", note: "Inbound buyer enquiries" },
  { id: "gem", label: "GeM", note: "Government tenders" },
  { id: "mca", label: "MCA", note: "Corporate filings" },
  { id: "zauba", label: "Zauba", note: "Trade activity" },
  { id: "funding", label: "Funding", note: "Capital events" },
  { id: "naukri", label: "Naukri", note: "Hiring intent" },
];

export default function SetupWizard() {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [form, setForm] = useState({
    company: "",
    industry: "",
    keywords: "cloud, software, automation",
    regions: "India, UAE",
    minAmount: "0",
    sources: SOURCE_OPTIONS.map(source => source.id),
  });

  const keywords = useMemo(
    () => form.keywords.split(",").map(item => item.trim()).filter(Boolean),
    [form.keywords]
  );
  const regions = useMemo(
    () => form.regions.split(",").map(item => item.trim()).filter(Boolean),
    [form.regions]
  );

  const toggleSource = (sourceId: string) => {
    setForm(current => ({
      ...current,
      sources: current.sources.includes(sourceId)
        ? current.sources.filter(id => id !== sourceId)
        : [...current.sources, sourceId],
    }));
  };

  const finishSetup = async () => {
    setSaving(true);
    setWarning(null);

    const profile = {
      company: form.company.trim(),
      industry: form.industry.trim(),
      keywords,
      regions,
      minAmount: Number(form.minAmount) || 0,
      sources: form.sources,
      completedAt: new Date().toISOString(),
    };

    try {
      await Promise.allSettled(
        SOURCE_OPTIONS.map(source =>
          api.post("/api/sources/toggle", {
            sourceId: source.id,
            enabled: form.sources.includes(source.id),
          })
        )
      );

      if (keywords.length > 0 || regions.length > 0) {
        await api.post("/api/watch-profiles", {
          keywords,
          regions,
          min_amount: profile.minAmount,
        });
      }
    } catch (error) {
      setWarning(error instanceof Error ? error.message : "Setup saved locally; server sync failed.");
    } finally {
      localStorage.setItem(ONBOARDING_PROFILE_KEY, JSON.stringify(profile));
      localStorage.setItem(ONBOARDING_COMPLETE_KEY, "true");
      setSaving(false);
      navigate("/");
    }
  };

  return (
    <div className="min-h-screen bg-[#020813] text-white px-6 py-8">
      <div
        className="fixed inset-0 bg-cover bg-center opacity-20"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=2200&q=80')",
        }}
      />
      <div className="fixed inset-0 bg-[#020813]/75" />

      <main className="relative z-10 max-w-5xl mx-auto">
        <header className="flex items-center justify-between mb-10">
          <div>
            <div className="text-[10px] font-black uppercase tracking-[0.3em] text-[#00ffca]">Setup Wizard</div>
            <h1 className="mt-2 text-3xl md:text-5xl font-black uppercase tracking-tight">Tune your signal radar.</h1>
          </div>
          <div className="hidden md:flex items-center gap-2">
            {[0, 1, 2].map(index => (
              <div key={index} className={`h-1.5 w-16 ${index <= step ? "bg-[#00ffca]" : "bg-white/10"}`} />
            ))}
          </div>
        </header>

        <section className="border border-white/10 bg-black/45 backdrop-blur-xl p-6 md:p-8">
          {step === 0 && (
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <Globe2 className="w-8 h-8 text-[#00ffca] mb-5" />
                <h2 className="text-xl font-black uppercase tracking-widest">Company and Industry</h2>
                <p className="mt-3 text-sm text-white/50 leading-relaxed">Tell the system what kind of demand matters to you.</p>
              </div>
              <div className="space-y-5">
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">Company</span>
                  <input
                    value={form.company}
                    onChange={event => setForm({ ...form, company: event.target.value })}
                    placeholder="Acme Industrial AI"
                    className="mt-2 w-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">Industry</span>
                  <input
                    value={form.industry}
                    onChange={event => setForm({ ...form, industry: event.target.value })}
                    placeholder="IT services, manufacturing, logistics..."
                    className="mt-2 w-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 1 && (
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <Search className="w-8 h-8 text-[#00ffca] mb-5" />
                <h2 className="text-xl font-black uppercase tracking-widest">Keywords and Regions</h2>
                <p className="mt-3 text-sm text-white/50 leading-relaxed">These become your first watch profile for tender and registry matching.</p>
              </div>
              <div className="space-y-5">
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">Keywords</span>
                  <textarea
                    value={form.keywords}
                    onChange={event => setForm({ ...form, keywords: event.target.value })}
                    rows={4}
                    className="mt-2 w-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                  />
                </label>
                <label className="block">
                  <span className="text-[10px] font-black uppercase tracking-[0.25em] text-white/35">Regions</span>
                  <input
                    value={form.regions}
                    onChange={event => setForm({ ...form, regions: event.target.value })}
                    className="mt-2 w-full bg-white/5 border border-white/10 px-4 py-3 text-sm text-white outline-none focus:border-[#00ffca]/60"
                  />
                </label>
              </div>
            </div>
          )}

          {step === 2 && (
            <div className="grid md:grid-cols-2 gap-8">
              <div>
                <Database className="w-8 h-8 text-[#00ffca] mb-5" />
                <h2 className="text-xl font-black uppercase tracking-widest">Source Mix</h2>
                <p className="mt-3 text-sm text-white/50 leading-relaxed">Choose where the first signal scans should listen.</p>
              </div>
              <div className="grid sm:grid-cols-2 gap-3">
                {SOURCE_OPTIONS.map(source => {
                  const selected = form.sources.includes(source.id);
                  return (
                    <button
                      key={source.id}
                      type="button"
                      onClick={() => toggleSource(source.id)}
                      className={`text-left border px-4 py-4 transition-all ${
                        selected ? "border-[#00ffca]/60 bg-[#00ffca]/10" : "border-white/10 bg-white/[0.03]"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-black uppercase tracking-widest">{source.label}</span>
                        {selected && <Check className="w-4 h-4 text-[#00ffca]" />}
                      </div>
                      <p className="mt-2 text-xs text-white/45">{source.note}</p>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {warning && (
            <div className="mt-6 border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-xs text-amber-200">
              {warning}
            </div>
          )}

          <footer className="mt-10 flex items-center justify-between border-t border-white/10 pt-6">
            <button
              type="button"
              onClick={() => setStep(Math.max(0, step - 1))}
              disabled={step === 0}
              className="px-5 py-2 border border-white/10 text-xs font-black uppercase tracking-widest text-white/50 disabled:opacity-30"
            >
              Back
            </button>
            {step < 2 ? (
              <button
                type="button"
                onClick={() => setStep(step + 1)}
                className="px-7 py-3 bg-[#00ffca] text-black text-xs font-black uppercase tracking-widest hover:bg-white"
              >
                Continue
              </button>
            ) : (
              <button
                type="button"
                onClick={finishSetup}
                disabled={saving}
                className="inline-flex items-center gap-2 px-7 py-3 bg-[#00ffca] text-black text-xs font-black uppercase tracking-widest hover:bg-white disabled:opacity-60"
              >
                <Sparkles className="w-4 h-4" />
                {saving ? "Saving" : "Launch Terminal"}
              </button>
            )}
          </footer>
        </section>
      </main>
    </div>
  );
}

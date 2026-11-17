import { useCallback, useEffect, useState } from "react";
import { api } from "../lib/api";

interface Summary {
  configured: boolean;
  source?: "tenant" | "env";
  api_base_url?: string;
  key_hint?: string;
}

const field = "w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-xs text-white placeholder:text-white/20 focus:border-[#00ffca]/40 focus:outline-none";
const label = "mb-1 block text-[9px] font-black uppercase tracking-widest text-white/40";

/** Where a workspace admin stores its own CraftMyFunnel URL, API key and signing secret. */
export default function CmfConnectionForm({ onChange }: { onChange?: () => void }) {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [form, setForm] = useState({ api_base_url: "", api_key: "", hmac_secret: "" });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await api.get("/api/integrations/craftmyfunnel/connection");
      setSummary(await res.json());
    } catch {
      setSummary(null);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMessage(null);
    try {
      const res = await api.put("/api/integrations/craftmyfunnel/connection", form);
      setSummary(await res.json());
      setForm({ api_base_url: "", api_key: "", hmac_secret: "" });
      setMessage({ ok: true, text: "Connection saved." });
      onChange?.();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not save." });
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm("Disconnect CraftMyFunnel? Signals will stop pushing until you reconnect.")) return;
    setBusy(true);
    try {
      await api.delete("/api/integrations/craftmyfunnel/connection");
      setMessage({ ok: true, text: "Disconnected." });
      await load();
      onChange?.();
    } catch (err) {
      setMessage({ ok: false, text: err instanceof Error ? err.message : "Could not disconnect." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mb-8 rounded-xl border border-white/10 bg-black/30 p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h4 className="text-[11px] font-black uppercase tracking-widest text-white/70">Your CraftMyFunnel workspace</h4>
          <p className="mt-1 text-[10px] text-white/35">
            {summary?.configured
              ? `Pushing to ${summary.api_base_url} with key ${summary.key_hint}${summary.source === "env" ? " (shared platform credentials)" : ""}.`
              : "Not connected. Signals are not pushed anywhere until you add your workspace."}
          </p>
        </div>
        {summary?.configured && summary.source === "tenant" && (
          <button type="button" onClick={remove} disabled={busy} className="text-[10px] font-black uppercase tracking-widest text-red-400/80 hover:text-red-400 disabled:opacity-40">
            Disconnect
          </button>
        )}
      </div>

      <form onSubmit={save} className="grid gap-3 md:grid-cols-3">
        <div>
          <label className={label} htmlFor="cmf-url">Workspace URL</label>
          <input id="cmf-url" className={field} placeholder="https://api.craftmyfunnel.live" value={form.api_base_url} onChange={e => setForm({ ...form, api_base_url: e.target.value })} required />
        </div>
        <div>
          <label className={label} htmlFor="cmf-key">API key</label>
          <input id="cmf-key" type="password" autoComplete="off" className={field} placeholder="Paste key" value={form.api_key} onChange={e => setForm({ ...form, api_key: e.target.value })} required minLength={8} />
        </div>
        <div>
          <label className={label} htmlFor="cmf-secret">Signing secret</label>
          <input id="cmf-secret" type="password" autoComplete="off" className={field} placeholder="Paste secret" value={form.hmac_secret} onChange={e => setForm({ ...form, hmac_secret: e.target.value })} required minLength={8} />
        </div>
        <div className="flex items-center gap-4 md:col-span-3">
          <button type="submit" disabled={busy} className="rounded-lg border border-[#00ffca]/20 bg-[#00ffca]/10 px-4 py-2 text-[10px] font-black uppercase tracking-widest text-[#00ffca] hover:bg-[#00ffca]/20 disabled:opacity-40">
            {summary?.configured && summary.source === "tenant" ? "Replace credentials" : "Connect"}
          </button>
          {message && <span className={`text-[10px] font-bold ${message.ok ? "text-emerald-400" : "text-red-400"}`}>{message.text}</span>}
        </div>
      </form>
      <p className="mt-3 text-[10px] text-white/30">Admins only. The key and secret are encrypted and are not shown again after saving.</p>
    </div>
  );
}

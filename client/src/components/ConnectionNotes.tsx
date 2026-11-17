import { useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown, Copy, Check, KeyRound, Link2, Radio } from "lucide-react";

export type CmfStatus = "loading" | "connected" | "not_connected";

const INGEST_SOURCES = ["gem", "indiamart", "funding", "naukri", "zauba", "mca", "parivesh", "rera"];

function CopyLine({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setCopied(false);
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      className="mt-2 flex w-full items-center justify-between gap-2 rounded-md border border-white/10 bg-black/40 px-2.5 py-1.5 text-left font-mono text-[10px] text-white/60 hover:border-white/20"
    >
      <span className="truncate">{text}</span>
      {copied ? <Check className="h-3 w-3 shrink-0 text-[#00ffca]" /> : <Copy className="h-3 w-3 shrink-0 text-white/30" />}
    </button>
  );
}

function Section({
  icon: Icon,
  title,
  tag,
  defaultOpen = false,
  children,
}: {
  icon: typeof KeyRound;
  title: string;
  tag?: { label: string; tone: "ok" | "warn" | "mute" };
  defaultOpen?: boolean;
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const tone = tag?.tone === "ok" ? "text-[#00ffca] bg-[#00ffca]/10" : tag?.tone === "warn" ? "text-amber-300 bg-amber-300/10" : "text-white/40 bg-white/5";
  return (
    <div className="border-b border-white/5 last:border-b-0">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left hover:bg-white/[0.03]"
      >
        <Icon className="h-3.5 w-3.5 shrink-0 text-white/40" />
        <span className="flex-1 text-[10px] font-black uppercase tracking-widest text-white/70">{title}</span>
        {tag && <span className={`rounded px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider ${tone}`}>{tag.label}</span>}
        <ChevronDown className={`h-3 w-3 text-white/30 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && <div className="px-3 pb-3 pl-9 text-[11px] leading-relaxed text-white/50">{children}</div>}
    </div>
  );
}

/**
 * Short notes on the three ways data moves in and out of a workspace. Shared by the header
 * notice and the setup wizard so the guidance never drifts.
 */
export default function ConnectionNotes({ cmf, onNavigate }: { cmf: CmfStatus; onNavigate?: () => void }) {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  const cmfTag =
    cmf === "connected" ? { label: "Connected", tone: "ok" as const }
    : cmf === "not_connected" ? { label: "Not connected", tone: "warn" as const }
    : { label: "Checking", tone: "mute" as const };

  return (
    <div>
      <Section icon={KeyRound} title="Your API key" defaultOpen>
        <p>
          Each workspace has one key. Send it as <code className="text-white/70">x-api-key</code> when you pull leads or post signals.
          Treat it like a password: it is shown once, never share it in chat or code, and rotate it if it leaks.
        </p>
      </Section>

      <Section icon={Link2} title="CraftMyFunnel" tag={cmfTag}>
        <p>
          Your signals push to your own CraftMyFunnel workspace, never a shared one. Add its URL, API key and signing secret in{" "}
          <Link to="/app/api" onClick={onNavigate} className="text-[#00ffca] hover:underline">API Manager</Link>. Only the last 4 characters of the key are ever shown again.
        </p>
        <p className="mt-2">If a push was missed, catch up with a pull:</p>
        <CopyLine text={`GET ${origin}/v1/intel/leads?since=2026-01-01T00:00:00Z&limit=50`} />
        <p className="mt-2 text-white/35">Follow <code>next_cursor</code> until it is null. Signals only: no contact details are returned.</p>
      </Section>

      <Section icon={Radio} title="Other websites feeding signals">
        <p>
          Approved sources post buyer signals to your workspace over HTTPS with the same <code className="text-white/70">x-api-key</code>.
          Their server addresses must be on your allowlist, and signed sources also send <code className="text-white/70">x-source-signature</code>.
        </p>
        <CopyLine text={`POST ${origin}/api/ingest/{source}`} />
        <p className="mt-2 text-white/35">Sources: {INGEST_SOURCES.join(", ")}.</p>
      </Section>
    </div>
  );
}

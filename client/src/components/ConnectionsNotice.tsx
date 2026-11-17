import { useEffect, useState } from "react";
import { Plug } from "lucide-react";
import { api } from "../lib/api";
import ConnectionNotes, { type CmfStatus } from "./ConnectionNotes";

const SEEN_KEY = "netjana_connections_notice_seen";

function readSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === "1";
  } catch {
    return false;
  }
}

/** Header notice: a quiet plug icon that opens a collapsible note on keys, CraftMyFunnel and signal sources. */
export default function ConnectionsNotice() {
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(readSeen);
  const [cmf, setCmf] = useState<CmfStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    api.get("/api/integrations/craftmyfunnel/connection")
      .then(res => res.json())
      .then(data => { if (!cancelled) setCmf(data.configured ? "connected" : "not_connected"); })
      .catch(() => { if (!cancelled) setCmf("not_connected"); });
    return () => { cancelled = true; };
  }, []);

  const toggle = () => {
    setOpen(v => !v);
    if (!seen) {
      setSeen(true);
      try { localStorage.setItem(SEEN_KEY, "1"); } catch { /* storage unavailable */ }
    }
  };

  // The dot stays until the notice is opened once, and returns if CraftMyFunnel is not connected.
  const showDot = !seen || cmf === "not_connected";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={toggle}
        aria-label="Connections"
        aria-expanded={open}
        className="relative flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/5 transition-colors hover:bg-white/10"
      >
        <Plug className="h-4 w-4 text-white/60" />
        {showDot && <span className="absolute -right-0.5 -top-0.5 h-2 w-2 rounded-full bg-[#00ffca] ring-2 ring-black" />}
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full z-50 mt-2 w-[22rem] max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-white/10 bg-black/90 shadow-2xl backdrop-blur-xl">
            <div className="border-b border-white/5 bg-white/[0.02] p-3">
              <h3 className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-white/60">
                <Plug className="h-3 w-3 text-[#00ffca]" />
                Connections
              </h3>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              <ConnectionNotes cmf={cmf} onNavigate={() => setOpen(false)} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

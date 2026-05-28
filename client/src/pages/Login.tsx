import { Link } from "react-router-dom";
import { ArrowRight, Terminal } from "lucide-react";
import { SignInButton, SignUpButton, SignedIn, SignedOut } from "../lib/auth";

export default function Login() {
  return (
    <div className="min-h-screen bg-[#020813] text-white flex items-center justify-center px-6">
      <div
        className="absolute inset-0 bg-cover bg-center opacity-25"
        style={{
          backgroundImage:
            "url('https://images.unsplash.com/photo-1518770660439-4636190af475?auto=format&fit=crop&w=2200&q=80')",
        }}
      />
      <div className="absolute inset-0 bg-[#020813]/70" />

      <main className="relative z-10 w-full max-w-md border border-white/10 bg-black/50 p-8 backdrop-blur-xl">
        <Link to="/" className="inline-flex items-center gap-2 text-[#00ffca] mb-10">
          <Terminal className="w-5 h-5" />
          <span className="text-[10px] font-black uppercase tracking-[0.25em]">ConvoSpan Intel</span>
        </Link>

        <h1 className="text-3xl font-black uppercase tracking-tight leading-none">Login to configure your radar.</h1>
        <p className="mt-4 text-sm text-white/55 leading-relaxed">
          After login, we will ask for your industry, buying-signal keywords, regions, and preferred registry sources.
        </p>

        <div className="mt-8">
          <SignedOut>
            <div className="grid gap-3">
              <SignInButton mode="modal">
                <button className="w-full h-12 bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.25em] hover:bg-white transition-colors">
                  Sign In
                </button>
              </SignInButton>
              <SignUpButton mode="modal">
                <button className="w-full h-12 border border-[#00ffca]/40 bg-[#00ffca]/10 text-[#00ffca] text-xs font-black uppercase tracking-[0.25em] hover:bg-[#00ffca] hover:text-black transition-colors">
                  Create Account
                </button>
              </SignUpButton>
            </div>
          </SignedOut>

          <SignedIn>
            <Link
              to="/setup"
              className="w-full h-12 bg-[#00ffca] text-black text-xs font-black uppercase tracking-[0.25em] hover:bg-white transition-colors flex items-center justify-center gap-2"
            >
              Continue Setup <ArrowRight className="w-4 h-4" />
            </Link>
          </SignedIn>
        </div>

        <div className="mt-6 border-t border-white/10 pt-5 text-[10px] uppercase tracking-[0.2em] text-white/30 leading-relaxed">
          Local dev mode uses a mock signed-in user until real Clerk keys are provided.
        </div>
      </main>
    </div>
  );
}

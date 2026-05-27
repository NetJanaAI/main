import { SignInButton, useAuth } from '../lib/auth';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#020813] text-white flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-[#D4AF37] animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#020813] text-white flex items-center justify-center p-8">
        <div className="max-w-md w-full border border-white/10 bg-white/[0.03] rounded-xl p-8 text-center">
          <h1 className="text-lg font-black uppercase tracking-widest text-[#D4AF37] mb-3">Protocol Access Required</h1>
          <p className="text-sm text-white/50 mb-6">Sign in to access the intelligence terminal.</p>
          <SignInButton mode="modal">
            <button className="px-6 py-3 bg-[#D4AF37] text-black text-xs font-black uppercase tracking-widest rounded-md">
              Sign In
            </button>
          </SignInButton>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

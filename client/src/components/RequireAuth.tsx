import { SignInButton, useAuth, isFallbackAuthActive } from '../lib/auth';

export default function RequireAuth({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useAuth();

  if (!isLoaded) {
    return (
      <div className="min-h-screen bg-[#020813] text-white flex items-center justify-center">
        <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-[#00ffca] animate-spin" />
      </div>
    );
  }

  if (!isSignedIn) {
    return (
      <div className="min-h-screen bg-[#020813] text-white flex items-center justify-center p-8">
        <div className="max-w-md w-full border border-white/10 bg-white/[0.03] rounded-xl p-8 text-center backdrop-blur-md shadow-2xl">
          <h1 className="text-lg font-black uppercase tracking-widest text-[#00ffca] mb-3">Protocol Access Required</h1>
          <p className="text-sm text-white/50 mb-6">
            {isFallbackAuthActive
              ? 'Clerk authentication keys are not provisioned. You can enter in Demo Mode or configure keys in Vercel.'
              : 'Sign in to access the intelligence terminal.'}
          </p>
          <div className="flex flex-col gap-3">
            {isFallbackAuthActive ? (
              <button
                onClick={() => {
                  window.localStorage.setItem('netjana_demo_auth', 'true');
                  window.location.reload();
                }}
                className="w-full py-3 bg-[#00ffca] hover:bg-[#00e5b5] text-black text-xs font-black uppercase tracking-widest rounded-md transition-colors cursor-pointer"
              >
                Enter Protocol (Demo Mode)
              </button>
            ) : (
              <SignInButton mode="modal">
                <button className="w-full py-3 bg-[#00ffca] hover:bg-[#00e5b5] text-black text-xs font-black uppercase tracking-widest rounded-md transition-colors cursor-pointer">
                  Sign In
                </button>
              </SignInButton>
            )}
          </div>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}

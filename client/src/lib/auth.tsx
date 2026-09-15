import React from 'react';

/* eslint-disable react-hooks/rules-of-hooks */

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const isDummyPublishableKey =
  !publishableKey ||
  publishableKey.includes('ZHVtbXlrZXk') ||
  publishableKey.toLowerCase().includes('dummy');
const fallbackAuthEnabled = isDummyPublishableKey;
const isDemoAuthStored =
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('netjana_demo_auth') === 'true';
const fallbackSignedIn =
  fallbackAuthEnabled &&
  (import.meta.env.DEV ||
    import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' ||
    import.meta.env.VITE_ALLOW_DEMO_AUTH === 'true' ||
    isDemoAuthStored);

export const isFallbackAuthActive = fallbackAuthEnabled;
export const isDemoSessionActive = isDemoAuthStored;

// ---------------------------------------------------------------------------
// Lazy Clerk import — only resolves when a real key is present.
// This prevents Clerk's CDN script from being injected when using a dummy key,
// which caused ERR_CONNECTION_CLOSED errors on Vercel deployments.
// ---------------------------------------------------------------------------
type ClerkMod = typeof import('@clerk/clerk-react');
let _clerk: ClerkMod | null = null;

if (!fallbackAuthEnabled) {
  import('@clerk/clerk-react').then((mod) => {
    _clerk = mod;
  });
}

function clk(): ClerkMod {
  if (!_clerk) {
    throw new Error(
      '[Auth] Clerk module accessed before dynamic import resolved. ' +
        'Make sure you are not calling Clerk hooks/components when fallbackAuthEnabled = true.'
    );
  }
  return _clerk;
}

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!fallbackAuthEnabled) {
    // We know _clerk will be loaded by the time React renders because the
    // dynamic import is triggered synchronously at module evaluation time
    // (micro-task queue), so by first render it will be resolved.
    const ClerkProviderLazy = React.lazy(
      () =>
        import('@clerk/clerk-react').then((mod) => ({
          default: ({ children: c }: { children: React.ReactNode }) => (
            <mod.ClerkProvider publishableKey={publishableKey!} afterSignOutUrl="/">
              {c}
            </mod.ClerkProvider>
          ),
        }))
    );
    return (
      <React.Suspense fallback={
        <div className="min-h-screen bg-[#020813] flex items-center justify-center">
          <div className="h-8 w-8 rounded-full border-2 border-white/10 border-t-[#00ffca] animate-spin" />
        </div>
      }>
        <ClerkProviderLazy>{children}</ClerkProviderLazy>
      </React.Suspense>
    );
  }

  if (import.meta.env.PROD) {
    console.warn(
      '[Auth] VITE_CLERK_PUBLISHABLE_KEY is missing or a placeholder; ' +
        'running with fallback/demo authentication.'
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// UserButton
// ---------------------------------------------------------------------------
export function UserButton(props: Record<string, unknown>) {
  if (!fallbackAuthEnabled) {
    const { UserButton: ClerkUserButton } = clk();
    return <ClerkUserButton {...(props as Parameters<typeof ClerkUserButton>[0])} />;
  }
  return (
    <button
      onClick={() => {
        if (typeof window !== 'undefined' && window.confirm('Sign out of Demo Mode?')) {
          window.localStorage.removeItem('netjana_demo_auth');
          window.location.reload();
        }
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/10 text-[10px] font-black text-white hover:bg-white/20 transition-colors cursor-pointer"
      title={isDemoAuthStored ? 'Demo User (Click to sign out)' : 'Local dev user'}
    >
      {isDemoAuthStored ? 'DEMO' : 'DEV'}
    </button>
  );
}

// ---------------------------------------------------------------------------
// OrganizationSwitcher
// ---------------------------------------------------------------------------
export function OrganizationSwitcher(props: Record<string, unknown>) {
  if (!fallbackAuthEnabled) {
    const { OrganizationSwitcher: ClerkOrganizationSwitcher } = clk();
    return (
      <ClerkOrganizationSwitcher
        {...(props as Parameters<typeof ClerkOrganizationSwitcher>[0])}
      />
    );
  }
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
      {isDemoAuthStored ? 'Demo Organization' : 'Local Dev Org'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignInButton
// ---------------------------------------------------------------------------
export function SignInButton({
  children,
  ...props
}: { children?: React.ReactNode } & Record<string, unknown>) {
  if (!fallbackAuthEnabled) {
    const { SignInButton: ClerkSignInButton } = clk();
    return (
      <ClerkSignInButton {...(props as Parameters<typeof ClerkSignInButton>[0])}>
        {children}
      </ClerkSignInButton>
    );
  }
  if (React.isValidElement<{ onClick?: () => void; title?: string }>(children) && !fallbackSignedIn) {
    return React.cloneElement(children, {
      onClick: () => {
        if (typeof window !== 'undefined') {
          const enterDemo = window.confirm(
            'Clerk authentication keys (VITE_CLERK_PUBLISHABLE_KEY) are not provisioned in this deployment.\n\nWould you like to enter in Demo Mode to explore the terminal?'
          );
          if (enterDemo) {
            window.localStorage.setItem('netjana_demo_auth', 'true');
            window.location.reload();
          }
        }
      },
      title: 'Sign in with Demo Mode',
    });
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// SignUpButton
// ---------------------------------------------------------------------------
export function SignUpButton({
  children,
  ...props
}: { children?: React.ReactNode } & Record<string, unknown>) {
  if (!fallbackAuthEnabled) {
    const { SignUpButton: ClerkSignUpButton } = clk();
    return (
      <ClerkSignUpButton {...(props as Parameters<typeof ClerkSignUpButton>[0])}>
        {children}
      </ClerkSignUpButton>
    );
  }
  if (React.isValidElement<{ onClick?: () => void; title?: string }>(children) && !fallbackSignedIn) {
    return React.cloneElement(children, {
      onClick: () => {
        if (typeof window !== 'undefined') {
          const enterDemo = window.confirm(
            'Clerk authentication keys (VITE_CLERK_PUBLISHABLE_KEY) are not provisioned in this deployment.\n\nWould you like to enter in Demo Mode to explore the terminal?'
          );
          if (enterDemo) {
            window.localStorage.setItem('netjana_demo_auth', 'true');
            window.location.reload();
          }
        }
      },
      title: 'Sign in with Demo Mode',
    });
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// SignedIn / SignedOut
// ---------------------------------------------------------------------------
export function SignedIn({ children }: { children: React.ReactNode }) {
  if (!fallbackAuthEnabled) {
    const { SignedIn: ClerkSignedIn } = clk();
    return <ClerkSignedIn>{children}</ClerkSignedIn>;
  }
  return fallbackSignedIn ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  if (!fallbackAuthEnabled) {
    const { SignedOut: ClerkSignedOut } = clk();
    return <ClerkSignedOut>{children}</ClerkSignedOut>;
  }
  return fallbackSignedIn ? null : <>{children}</>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export function useUser() {
  if (!fallbackAuthEnabled) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return clk().useUser();
  }
  return {
    user: fallbackSignedIn
      ? {
          fullName: 'Local Dev User',
          primaryEmailAddress: { emailAddress: 'local.dev@example.test' },
        }
      : null,
    isLoaded: true,
    isSignedIn: fallbackSignedIn,
  } as ReturnType<ClerkMod['useUser']>;
}

export function useOrganization() {
  if (!fallbackAuthEnabled) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return clk().useOrganization();
  }
  return {
    organization: { name: 'Local Dev Organization' },
    isLoaded: true,
  } as ReturnType<ClerkMod['useOrganization']>;
}

export function useAuth() {
  if (!fallbackAuthEnabled) {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return clk().useAuth();
  }
  return {
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: fallbackSignedIn,
  } as ReturnType<ClerkMod['useAuth']>;
}

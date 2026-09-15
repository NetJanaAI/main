/**
 * auth.tsx — Auth abstraction layer
 *
 * When VITE_CLERK_PUBLISHABLE_KEY is a real key, this wraps @clerk/clerk-react normally.
 * When the key is absent/dummy, vite.config.ts aliases @clerk/clerk-react to clerk-stub.ts,
 * so Clerk's CDN script is never bundled or injected.
 *
 * Auth state in fallback/demo mode is driven by localStorage: netjana_demo_auth = 'true'
 */
import React from 'react';
import {
  ClerkProvider,
  OrganizationSwitcher as ClerkOrganizationSwitcher,
  SignInButton as ClerkSignInButton,
  SignUpButton as ClerkSignUpButton,
  SignedIn as ClerkSignedIn,
  SignedOut as ClerkSignedOut,
  UserButton as ClerkUserButton,
  useAuth as useClerkAuth,
  useOrganization as useClerkOrganization,
  useUser as useClerkUser,
} from '@clerk/clerk-react';

/* eslint-disable react-hooks/rules-of-hooks */

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;
const isDummyPublishableKey =
  !publishableKey ||
  publishableKey.includes('ZHVtbXlrZXk') ||
  publishableKey.toLowerCase().includes('dummy');

// fallbackAuthEnabled is true when no real Clerk key is configured.
// In this mode, @clerk/clerk-react is already replaced with a stub by vite.config.ts,
// so ClerkProvider etc. are no-ops. Auth state comes from localStorage.
export const isFallbackAuthActive = isDummyPublishableKey;

const isDemoAuthStored =
  typeof window !== 'undefined' &&
  window.localStorage?.getItem('netjana_demo_auth') === 'true';

export const isDemoSessionActive = isDemoAuthStored;

// In fallback mode: signed in if in dev, or if user clicked "Enter Demo Mode"
const fallbackSignedIn =
  isFallbackAuthActive &&
  (import.meta.env.DEV ||
    import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' ||
    import.meta.env.VITE_ALLOW_DEMO_AUTH === 'true' ||
    isDemoAuthStored);

// ---------------------------------------------------------------------------
// AuthProvider
// ---------------------------------------------------------------------------
export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (!isFallbackAuthActive) {
    // Real Clerk key — mount ClerkProvider normally
    return (
      <ClerkProvider publishableKey={publishableKey!} afterSignOutUrl="/">
        {children}
      </ClerkProvider>
    );
  }

  // Fallback mode: ClerkProvider is the stub (no-op), just render children.
  // Log a warning in production so devs know auth is in demo mode.
  if (import.meta.env.PROD) {
    console.warn(
      '[Auth] VITE_CLERK_PUBLISHABLE_KEY is missing or a placeholder. ' +
        'Running in demo/fallback auth mode. Set a real key in Vercel env vars to enable Clerk.'
    );
  }
  return <>{children}</>;
}

// ---------------------------------------------------------------------------
// UserButton
// ---------------------------------------------------------------------------
export function UserButton(props: React.ComponentProps<typeof ClerkUserButton>) {
  if (!isFallbackAuthActive) return <ClerkUserButton {...props} />;
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
export function OrganizationSwitcher(props: React.ComponentProps<typeof ClerkOrganizationSwitcher>) {
  if (!isFallbackAuthActive) return <ClerkOrganizationSwitcher {...props} />;
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
      {isDemoAuthStored ? 'Demo Organization' : 'Local Dev Org'}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SignInButton
// ---------------------------------------------------------------------------
export function SignInButton({ children, ...props }: React.ComponentProps<typeof ClerkSignInButton>) {
  if (!isFallbackAuthActive) return <ClerkSignInButton {...props}>{children}</ClerkSignInButton>;
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
export function SignUpButton({ children, ...props }: React.ComponentProps<typeof ClerkSignUpButton>) {
  if (!isFallbackAuthActive) return <ClerkSignUpButton {...props}>{children}</ClerkSignUpButton>;
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
  if (!isFallbackAuthActive) return <ClerkSignedIn>{children}</ClerkSignedIn>;
  return fallbackSignedIn ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  if (!isFallbackAuthActive) return <ClerkSignedOut>{children}</ClerkSignedOut>;
  return fallbackSignedIn ? null : <>{children}</>;
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------
export function useUser() {
  if (!isFallbackAuthActive) return useClerkUser();
  return {
    user: fallbackSignedIn
      ? {
          fullName: 'Local Dev User',
          primaryEmailAddress: { emailAddress: 'local.dev@example.test' },
        }
      : null,
    isLoaded: true,
    isSignedIn: fallbackSignedIn,
  } as ReturnType<typeof useClerkUser>;
}

export function useOrganization() {
  if (!isFallbackAuthActive) return useClerkOrganization();
  return {
    organization: { name: 'Local Dev Organization' },
    isLoaded: true,
  } as ReturnType<typeof useClerkOrganization>;
}

export function useAuth() {
  if (!isFallbackAuthActive) return useClerkAuth();
  return {
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: fallbackSignedIn,
  } as ReturnType<typeof useClerkAuth>;
}

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
const isDummyPublishableKey = publishableKey?.includes('ZHVtbXlrZXk') || publishableKey?.toLowerCase().includes('dummy');
const fallbackAuthEnabled = !publishableKey || isDummyPublishableKey;
const isDemoAuthStored = typeof window !== 'undefined' && window.localStorage?.getItem('netjana_demo_auth') === 'true';
const fallbackSignedIn = fallbackAuthEnabled && (
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_DEMO_AUTH === 'true' ||
  import.meta.env.VITE_ALLOW_DEMO_AUTH === 'true' ||
  isDemoAuthStored
);

export const isFallbackAuthActive = fallbackAuthEnabled;
export const isDemoSessionActive = isDemoAuthStored;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (publishableKey && !isDummyPublishableKey) {
    return (
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        {children}
      </ClerkProvider>
    );
  }

  if (fallbackAuthEnabled) {
    if (import.meta.env.PROD) {
      console.warn('[Auth] VITE_CLERK_PUBLISHABLE_KEY is missing; running with fallback/demo authentication.');
    }
    return <>{children}</>;
  }

  return <>{children}</>;
}

export function UserButton(props: React.ComponentProps<typeof ClerkUserButton>) {
  if (!fallbackAuthEnabled) return <ClerkUserButton {...props} />;
  return (
    <button
      onClick={() => {
        if (typeof window !== 'undefined' && window.confirm('Sign out of Demo Mode?')) {
          window.localStorage.removeItem('netjana_demo_auth');
          window.location.reload();
        }
      }}
      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/10 text-[10px] font-black text-white hover:bg-white/20 transition-colors cursor-pointer"
      title={isDemoAuthStored ? "Demo User (Click to sign out)" : "Local dev user"}
    >
      {isDemoAuthStored ? 'DEMO' : 'DEV'}
    </button>
  );
}

export function OrganizationSwitcher(props: React.ComponentProps<typeof ClerkOrganizationSwitcher>) {
  if (!fallbackAuthEnabled) return <ClerkOrganizationSwitcher {...props} />;
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
      {isDemoAuthStored ? 'Demo Organization' : 'Local Dev Org'}
    </div>
  );
}

export function SignInButton({ children, ...props }: React.ComponentProps<typeof ClerkSignInButton>) {
  if (!fallbackAuthEnabled) return <ClerkSignInButton {...props}>{children}</ClerkSignInButton>;
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

export function SignUpButton({ children, ...props }: React.ComponentProps<typeof ClerkSignUpButton>) {
  if (!fallbackAuthEnabled) return <ClerkSignUpButton {...props}>{children}</ClerkSignUpButton>;
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

export function SignedIn({ children }: { children: React.ReactNode }) {
  if (!fallbackAuthEnabled) return <ClerkSignedIn>{children}</ClerkSignedIn>;
  return fallbackSignedIn ? <>{children}</> : null;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  if (!fallbackAuthEnabled) return <ClerkSignedOut>{children}</ClerkSignedOut>;
  return fallbackSignedIn ? null : <>{children}</>;
}

export function useUser() {
  if (!fallbackAuthEnabled) return useClerkUser();
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
  if (!fallbackAuthEnabled) return useClerkOrganization();
  return {
    organization: { name: 'Local Dev Organization' },
    isLoaded: true,
  } as ReturnType<typeof useClerkOrganization>;
}

export function useAuth() {
  if (!fallbackAuthEnabled) return useClerkAuth();
  return {
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: fallbackSignedIn,
  } as ReturnType<typeof useClerkAuth>;
}

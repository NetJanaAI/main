import React from 'react';
import {
  ClerkProvider,
  OrganizationSwitcher as ClerkOrganizationSwitcher,
  SignInButton as ClerkSignInButton,
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
const devAuthEnabled = (!publishableKey || isDummyPublishableKey) && import.meta.env.DEV;

export function AuthProvider({ children }: { children: React.ReactNode }) {
  if (publishableKey && !isDummyPublishableKey) {
    return (
      <ClerkProvider publishableKey={publishableKey} afterSignOutUrl="/">
        {children}
      </ClerkProvider>
    );
  }

  if (devAuthEnabled) {
    return <>{children}</>;
  }

  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY');
}

export function UserButton(props: React.ComponentProps<typeof ClerkUserButton>) {
  if (!devAuthEnabled) return <ClerkUserButton {...props} />;
  return (
    <div
      className="flex h-8 w-8 items-center justify-center rounded-full border border-white/10 bg-white/10 text-[10px] font-black text-white"
      title="Local dev user"
    >
      DEV
    </div>
  );
}

export function OrganizationSwitcher(props: React.ComponentProps<typeof ClerkOrganizationSwitcher>) {
  if (!devAuthEnabled) return <ClerkOrganizationSwitcher {...props} />;
  return (
    <div className="rounded-md border border-white/10 bg-white/5 px-3 py-2 text-[10px] font-black uppercase tracking-widest text-white">
      Local Dev Org
    </div>
  );
}

export function SignInButton({ children, ...props }: React.ComponentProps<typeof ClerkSignInButton>) {
  if (!devAuthEnabled) return <ClerkSignInButton {...props}>{children}</ClerkSignInButton>;
  return <>{children}</>;
}

export function SignedIn({ children }: { children: React.ReactNode }) {
  if (!devAuthEnabled) return <ClerkSignedIn>{children}</ClerkSignedIn>;
  return <>{children}</>;
}

export function SignedOut({ children }: { children: React.ReactNode }) {
  if (!devAuthEnabled) return <ClerkSignedOut>{children}</ClerkSignedOut>;
  return null;
}

export function useUser() {
  if (!devAuthEnabled) return useClerkUser();
  return {
    user: {
      fullName: 'Local Dev User',
      primaryEmailAddress: { emailAddress: 'local.dev@example.test' },
    },
    isLoaded: true,
    isSignedIn: true,
  } as ReturnType<typeof useClerkUser>;
}

export function useOrganization() {
  if (!devAuthEnabled) return useClerkOrganization();
  return {
    organization: { name: 'Local Dev Organization' },
    isLoaded: true,
  } as ReturnType<typeof useClerkOrganization>;
}

export function useAuth() {
  if (!devAuthEnabled) return useClerkAuth();
  return {
    getToken: async () => null,
    isLoaded: true,
    isSignedIn: true,
  } as ReturnType<typeof useClerkAuth>;
}

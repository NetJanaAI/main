/**
 * clerk-stub.ts
 *
 * A build-time no-op stub for @clerk/clerk-react.
 * Vite aliases this module when VITE_CLERK_PUBLISHABLE_KEY is absent or a dummy key,
 * so Clerk's CDN script is never injected and no ERR_CONNECTION_CLOSED errors occur.
 *
 * This file is NEVER loaded in a real Clerk-provisioned deployment.
 */

import React from 'react';

// Provider — just renders children
export function ClerkProvider({ children }: { children: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

// Buttons — render children as-is
export function SignInButton({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}
export function SignUpButton({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

// Guards — always "signed out" in stub
export function SignedIn() { return null; }
export function SignedOut({ children }: { children?: React.ReactNode }) {
  return React.createElement(React.Fragment, null, children);
}

// User components
export function UserButton() { return null; }
export function OrganizationSwitcher() { return null; }

// Hooks
export function useAuth() {
  return { isLoaded: true, isSignedIn: false, getToken: async () => null };
}
export function useUser() {
  return { isLoaded: true, isSignedIn: false, user: null };
}
export function useOrganization() {
  return { isLoaded: true, organization: null };
}
export function useClerk() {
  return {};
}
export function useSession() {
  return { isLoaded: true, isSignedIn: false, session: null };
}

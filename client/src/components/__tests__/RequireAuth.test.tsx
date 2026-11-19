import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';

const authState = { isLoaded: true, isSignedIn: false };
let fallback = false;

vi.mock('../../lib/auth', () => ({
  useAuth: () => authState,
  SignInButton: ({ children }: { children: React.ReactNode }) => children,
  get isFallbackAuthActive() {
    return fallback;
  },
}));

import RequireAuth from '../RequireAuth';
import { UNAUTHORIZED_EVENT } from '../../lib/api';

afterEach(() => {
  cleanup();
  authState.isLoaded = true;
  authState.isSignedIn = false;
  fallback = false;
});

describe('RequireAuth', () => {
  it('hides the protected content while the session loads', () => {
    authState.isLoaded = false;
    render(<RequireAuth><p>secret</p></RequireAuth>);
    expect(screen.queryByText('secret')).toBeNull();
  });

  it('hides the protected content from a signed-out visitor and offers sign in', () => {
    render(<RequireAuth><p>secret</p></RequireAuth>);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByText('Sign In')).toBeTruthy();
  });

  it('offers demo mode only when Clerk is not configured', () => {
    fallback = true;
    render(<RequireAuth><p>secret</p></RequireAuth>);
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByRole('button', { name: /Demo Mode/ })).toBeTruthy();
  });

  it('renders the protected content for a signed-in user', () => {
    authState.isSignedIn = true;
    render(<RequireAuth><p>secret</p></RequireAuth>);
    expect(screen.getByText('secret')).toBeTruthy();
  });

  it('asks a signed-in user to sign in again after the API rejects their session', () => {
    authState.isSignedIn = true;
    render(<RequireAuth><p>secret</p></RequireAuth>);
    act(() => { window.dispatchEvent(new Event(UNAUTHORIZED_EVENT)); });
    expect(screen.queryByText('secret')).toBeNull();
    expect(screen.getByRole('button', { name: 'Sign In Again' })).toBeTruthy();
  });
});

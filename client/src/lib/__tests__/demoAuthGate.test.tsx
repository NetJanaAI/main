import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

async function loadAuth() {
  vi.resetModules();
  return import('../auth');
}

describe('demo auth gate', () => {
  beforeEach(() => {
    window.localStorage.setItem('netjana_demo_auth', 'true');
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    window.localStorage.clear();
  });

  it('ignores a stored demo flag in a production build without the explicit opt-in', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ENABLE_DEMO_AUTH', '');
    vi.stubEnv('VITE_ALLOW_DEMO_AUTH', '');
    const auth = await loadAuth();
    expect(auth.isFallbackAuthActive).toBe(true);
    expect(auth.isDemoSessionActive).toBe(false);
    expect(auth.useAuth().isSignedIn).toBe(false);
  });

  it('honours the stored flag when demo auth is explicitly enabled', async () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('VITE_ENABLE_DEMO_AUTH', 'true');
    const auth = await loadAuth();
    expect(auth.isDemoSessionActive).toBe(true);
    expect(auth.useAuth().isSignedIn).toBe(true);
  });

  it('allows demo auth in development', async () => {
    vi.stubEnv('DEV', true);
    const auth = await loadAuth();
    expect(auth.useAuth().isSignedIn).toBe(true);
  });
});

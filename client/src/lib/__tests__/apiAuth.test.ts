import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let fallback = false;
vi.mock('../auth', () => ({
  get isFallbackAuthActive() {
    return fallback;
  },
}));

import { apiFetch, UNAUTHORIZED_EVENT } from '../api';

const ok = () => new Response('{}', { status: 200 });
const unauthorized = () => new Response('{"error":"no"}', { status: 401 });

function setClerk(getToken: (o?: { skipCache?: boolean }) => Promise<string | null>, loaded = true) {
  window.Clerk = { loaded, session: { getToken } };
}

describe('apiFetch authentication', () => {
  const fetchMock = vi.fn();

  beforeEach(() => {
    fallback = false;
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    delete window.Clerk;
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('sends the Clerk token as a bearer header', async () => {
    setClerk(async () => 'tok1');
    fetchMock.mockResolvedValue(ok());
    await apiFetch('/api/x');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer tok1');
  });

  it('waits for Clerk to finish loading instead of sending the request unauthenticated', async () => {
    window.Clerk = { loaded: false, session: { getToken: async () => 'late' } };
    setTimeout(() => { window.Clerk!.loaded = true; }, 120);
    fetchMock.mockResolvedValue(ok());
    await apiFetch('/api/x');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer late');
  });

  it('retries once with a fresh token after a 401', async () => {
    const getToken = vi.fn(async (o?: { skipCache?: boolean }) => (o?.skipCache ? 'fresh' : 'stale'));
    setClerk(getToken);
    fetchMock.mockResolvedValueOnce(unauthorized()).mockResolvedValueOnce(ok());
    const res = await apiFetch('/api/x');
    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchMock.mock.calls[1][1].headers).get('Authorization')).toBe('Bearer fresh');
  });

  it('signals an expired session when the fresh token is refused too', async () => {
    setClerk(async () => 'tok');
    const heard = vi.fn();
    window.addEventListener(UNAUTHORIZED_EVENT, heard);
    fetchMock.mockImplementation(async () => unauthorized());
    await expect(apiFetch('/api/x')).rejects.toMatchObject({ status: 401 });
    window.removeEventListener(UNAUTHORIZED_EVENT, heard);
    expect(heard).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not override or retry a caller-supplied Authorization header', async () => {
    setClerk(async () => 'tok');
    fetchMock.mockImplementation(async () => unauthorized());
    await expect(apiFetch('/api/x', { headers: { Authorization: 'Bearer mine' } })).rejects.toMatchObject({ status: 401 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(new Headers(fetchMock.mock.calls[0][1].headers).get('Authorization')).toBe('Bearer mine');
  });

  it('sends no token in demo mode', async () => {
    fallback = true;
    fetchMock.mockResolvedValue(ok());
    await apiFetch('/api/x');
    expect(new Headers(fetchMock.mock.calls[0][1].headers).has('Authorization')).toBe(false);
  });
});

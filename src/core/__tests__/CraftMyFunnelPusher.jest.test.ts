export {};
const ORG = '11111111-1111-1111-1111-111111111111';
const OTHER = '3fa85f64-5717-4562-b3fc-2c963f66afa6';
const queryWithOrg = jest.fn().mockResolvedValue({ rows: [] });
const validateTargetUrl = jest.fn().mockResolvedValue({ isValid: true });
jest.mock('../../lib/database', () => ({ query: jest.fn().mockResolvedValue({ rows: [] }), queryWithOrg: (...a: any[]) => queryWithOrg(...a) }));
jest.mock('../../middleware/urlValidator', () => ({ validateTargetUrl: (...a: any[]) => validateTargetUrl(...a) }));

describe('CraftMyFunnelPusher', () => {
    const originalEnv = process.env;
    const originalFetch = global.fetch;

    beforeEach(() => {
        jest.resetModules();
        process.env = {
            ...originalEnv,
            CRAFTMYFUNNEL_API_BASE_URL: 'https://cmf.example.com',
            CRAFTMYFUNNEL_API_KEY: 'cmf_test_key_1234',
            CRAFTMYFUNNEL_NETJANA_HMAC_SECRET: 'super-secret',
            CRAFTMYFUNNEL_ENV_FALLBACK_ORGS: ORG,
            CREDENTIAL_ENCRYPTION_KEY: 'ab'.repeat(32),
        };
        global.fetch = jest.fn();
        queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
        validateTargetUrl.mockReset().mockResolvedValue({ isValid: true });
    });

    afterEach(() => {
        process.env = originalEnv;
        global.fetch = originalFetch;
        jest.clearAllMocks();
    });

    it('maps a lead card into the CraftMyFunnel contract', async () => {
        const { mapLeadCardToCraftMyFunnelPayload } = await import('../CraftMyFunnelPusher');
        const payload = mapLeadCardToCraftMyFunnelPayload({
            lead_id: '00000000-0000-0000-0000-000000000001',
            company_name: 'Example Corp',
            intent_score: 87,
            geo_state: 'CA',
            sector: 'Manufacturing',
            source_id: 'netjana-source-id',
            buying_stage: 'decision',
            procurement_category: 'AI outreach',
            procurement_timeline: '30-60 days',
            verity_tier: 'TIER_1',
            is_triangulated: true,
            card_company: 'Example Corp',
            card_why_now: 'Recent buying signal',
            card_what_they_need: 'Outbound workflow support',
            card_do_this: 'Route to sales',
            created_at: '2026-06-04T12:00:00.000Z',
        });

        expect(payload).toEqual(expect.objectContaining({
            event: 'LEAD_CARD_READY',
            source: 'netjana-intel',
            timestamp: '2026-06-04T12:00:00.000Z',
            lead: expect.objectContaining({
                lead_id: '00000000-0000-0000-0000-000000000001',
                company_name: 'Example Corp',
                intent_score: 87,
                buying_stage: 'DECISION',
                verity_tier: 'TIER_1',
                is_triangulated: true,
            }),
            meta: { pushed_by: 'netjana', retry_attempt: 0 },
        }));
    });

    it('computes the HMAC signature from timestamp, nonce, and raw body', async () => {
        const { computeCraftMyFunnelSignature } = await import('../CraftMyFunnelPusher');
        const signature = computeCraftMyFunnelSignature(
            'super-secret',
            '2026-06-04T12:00:00.000Z',
            'nonce-123',
            '{"event":"LEAD_CARD_READY"}'
        );

        expect(signature).toBe('30f6791dff470d47dfca99abd53ba00c09d0215a4ed6b3e47f90367756c1973e');
    });

    it('sends a webhook successfully with signed headers', async () => {
        const fetchMock = global.fetch as jest.Mock;
        fetchMock.mockResolvedValue({
            ok: true,
            json: async () => ({ ok: true, signalId: 'sig_1', leadId: 'lead_1' }),
        });

        const { sendCraftMyFunnelLeadSignal } = await import('../CraftMyFunnelPusher');
        const result = await sendCraftMyFunnelLeadSignal({
            org_id: ORG,
            lead_id: '00000000-0000-0000-0000-000000000001',
            company_name: 'Example Corp',
            intent_score: 87,
            buying_stage: 'DECISION',
            verity_tier: 'TIER_1',
            created_at: '2026-06-04T12:00:00.000Z',
        });

        expect(result).toEqual(expect.objectContaining({ ok: true, signalId: 'sig_1' }));
        expect(fetchMock).toHaveBeenCalledTimes(1);
        const [, request] = fetchMock.mock.calls[0];
        expect(request.headers).toEqual(expect.objectContaining({
            'Authorization': 'Bearer cmf_test_key_1234',
            'x-api-key': 'cmf_test_key_1234',
            'Content-Type': 'application/json',
            'x-source': 'netjana-intel',
            'x-netjana-signature': expect.any(String),
        }));
    });

    it('builds endpoint URL whether given bare base URL, /webhooks/netjana-intel, or /api/webhooks/netjana-intel', async () => {
        const { buildEndpointUrl } = await import('../CraftMyFunnelPusher');
        expect(buildEndpointUrl('https://api.craftmyfunnel.live')).toBe('https://api.craftmyfunnel.live/api/webhooks/netjana-intel');
        expect(buildEndpointUrl('https://api.craftmyfunnel.live/')).toBe('https://api.craftmyfunnel.live/api/webhooks/netjana-intel');
        expect(buildEndpointUrl('https://api.craftmyfunnel.live/webhooks/netjana-intel')).toBe('https://api.craftmyfunnel.live/webhooks/netjana-intel');
        expect(buildEndpointUrl('https://api.craftmyfunnel.live/api/webhooks/netjana-intel/')).toBe('https://api.craftmyfunnel.live/api/webhooks/netjana-intel');
    });

    it('does not retry 401 or 403 auth failures', async () => {
        const fetchMock = global.fetch as jest.Mock;
        const { sendCraftMyFunnelLeadSignal } = await import('../CraftMyFunnelPusher');

        for (const status of [401, 403]) {
            fetchMock.mockClear();
            fetchMock.mockResolvedValue({
                ok: false,
                status,
                text: async () => status === 401 ? 'unauthorized' : 'forbidden',
            });

            const result = await sendCraftMyFunnelLeadSignal({
                org_id: ORG,
                lead_id: '00000000-0000-0000-0000-000000000001',
                company_name: 'Example Corp',
                intent_score: 87,
                buying_stage: 'DECISION',
                verity_tier: 'TIER_1',
                created_at: '2026-06-04T12:00:00.000Z',
            });

            expect(result).toEqual(expect.objectContaining({ ok: false, status }));
            expect(fetchMock).toHaveBeenCalledTimes(1);
        }
    });

    it('retries 429 and 5xx responses', async () => {
        const fetchMock = global.fetch as jest.Mock;
        fetchMock
            .mockResolvedValueOnce({
                ok: false,
                status: 429,
                text: async () => 'rate limited',
            })
            .mockResolvedValueOnce({
                ok: false,
                status: 502,
                text: async () => 'bad gateway',
            })
            .mockResolvedValueOnce({
                ok: true,
                json: async () => ({ ok: true, signalId: 'sig_3' }),
            });

        const { sendCraftMyFunnelLeadSignal } = await import('../CraftMyFunnelPusher');
        const result = await sendCraftMyFunnelLeadSignal({
            org_id: ORG,
            lead_id: '00000000-0000-0000-0000-000000000001',
            company_name: 'Example Corp',
            intent_score: 87,
            buying_stage: 'DECISION',
            verity_tier: 'TIER_1',
            created_at: '2026-06-04T12:00:00.000Z',
        });

        expect(result).toEqual(expect.objectContaining({ ok: true, signalId: 'sig_3' }));
        expect(fetchMock).toHaveBeenCalledTimes(3);
    });

    describe('per-tenant credentials', () => {
        const lead = (org: string) => ({
            org_id: org,
            lead_id: '00000000-0000-0000-0000-000000000001',
            company_name: 'Example Corp',
            intent_score: 87,
            buying_stage: 'DECISION',
            verity_tier: 'TIER_1',
            created_at: '2026-06-04T12:00:00.000Z',
        });

        it('pushes to the tenant own workspace with the tenant own key and secret', async () => {
            const vault = await import('../../lib/credentialVault');
            queryWithOrg.mockResolvedValue({ rows: [{
                api_base_url: 'https://tenant.example.com',
                api_key_enc: vault.encryptCredential('tenant-key-9999'),
                hmac_secret_enc: vault.encryptCredential('tenant-secret'),
            }] });
            const fetchMock = global.fetch as jest.Mock;
            fetchMock.mockResolvedValue({ ok: true, json: async () => ({ ok: true }) });

            const { sendCraftMyFunnelLeadSignal, computeCraftMyFunnelSignature } = await import('../CraftMyFunnelPusher');
            await sendCraftMyFunnelLeadSignal(lead(OTHER));

            const [url, request] = fetchMock.mock.calls[0];
            expect(url).toBe('https://tenant.example.com/api/webhooks/netjana-intel');
            expect(request.headers['x-api-key']).toBe('tenant-key-9999');
            expect(request.headers['x-netjana-signature']).toBe(
                computeCraftMyFunnelSignature('tenant-secret', request.headers['x-netjana-timestamp'], request.headers['x-netjana-nonce'], request.body)
            );
            expect(JSON.stringify(request)).not.toContain('env-key');
        });

        it('does not send a tenant with no connection to the global workspace', async () => {
            const fetchMock = global.fetch as jest.Mock;
            const { sendCraftMyFunnelLeadSignal } = await import('../CraftMyFunnelPusher');
            const result = await sendCraftMyFunnelLeadSignal(lead(OTHER));
            expect(result).toEqual({ ok: false, error: 'CraftMyFunnel integration is not configured' });
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('does not send a lead with no tenant id', async () => {
            const fetchMock = global.fetch as jest.Mock;
            const { sendCraftMyFunnelLeadSignal } = await import('../CraftMyFunnelPusher');
            const result = await sendCraftMyFunnelLeadSignal({ ...lead(ORG), org_id: undefined });
            expect(result).toEqual(expect.objectContaining({ ok: false }));
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it('refuses to call a tenant URL that is not a public https address', async () => {
            const vault = await import('../../lib/credentialVault');
            queryWithOrg.mockResolvedValue({ rows: [{
                api_base_url: 'https://internal.example.com',
                api_key_enc: vault.encryptCredential('k'),
                hmac_secret_enc: vault.encryptCredential('s'),
            }] });
            validateTargetUrl.mockResolvedValue({ isValid: false, error: 'Blocked non-public address: 10.0.0.5' });
            const fetchMock = global.fetch as jest.Mock;
            const { sendCraftMyFunnelLeadSignal } = await import('../CraftMyFunnelPusher');
            const result = await sendCraftMyFunnelLeadSignal(lead(OTHER));
            expect(result).toEqual(expect.objectContaining({ ok: false, error: expect.stringContaining('Blocked') }));
            expect(fetchMock).not.toHaveBeenCalled();
        });
    });
});

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
        };
        global.fetch = jest.fn();
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
            'Content-Type': 'application/json',
            'x-source': 'netjana-intel',
            'x-netjana-signature': expect.any(String),
        }));
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
});

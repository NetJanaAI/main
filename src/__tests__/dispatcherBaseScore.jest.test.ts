export {};
const query = jest.fn();

jest.mock('../lib/database', () => ({ query: (...a: any[]) => query(...a) }));
jest.mock('../lib/ai/SovereignFirewall', () => ({ SovereignFirewall: jest.fn() }));
jest.mock('../lib/dataCapsule', () => ({ generateCapsule: () => ({}), signCapsule: () => 'sig' }));
jest.mock('../lib/secrets', () => ({ getHmacSecret: () => 'secret' }));
jest.mock('../config/mode', () => ({ IS_COVOSPAN: false }));
jest.mock('axios', () => ({ post: jest.fn() }));

const ORG = '11111111-1111-1111-1111-111111111111';

async function insertParams(frictionScore: unknown) {
    query.mockReset().mockResolvedValue({ rows: [] });
    const { sendResults } = await import('../dispatcher');
    await sendResults({ jobId: 'j1', domain: 'acme.com', frictionScore, signals: [] }, ORG);
    const call = query.mock.calls.find((c) => /INSERT INTO scrape_results/.test(c[0]));
    return { sql: call![0] as string, params: call![1] as unknown[] };
}

describe('dispatcher persists the score that intent decay starts from', () => {
    beforeEach(() => {
        jest.spyOn(console, 'log').mockImplementation(() => undefined);
        jest.spyOn(console, 'info').mockImplementation(() => undefined);
        jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    });

    it('writes base_score from the friction score', async () => {
        const { sql, params } = await insertParams(72);
        expect(sql).toMatch(/base_score/);
        expect(params[params.length - 1]).toBe(72);
    });

    it('keeps base_score within 0 to 100', async () => {
        expect((await insertParams(250)).params.at(-1)).toBe(100);
        expect((await insertParams(-5)).params.at(-1)).toBe(0);
        expect((await insertParams('not a number')).params.at(-1)).toBe(0);
    });
});

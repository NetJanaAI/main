export {};
// POST /api/scrape answers 429 when the tenant is out of quota, and queues nothing.
const enqueueScrape = jest.fn();

class QuotaExceededError extends Error {
    constructor(public limit: number, public used: number) { super('quota'); }
}
jest.mock('../../lib/quota', () => ({ enqueueScrape, QuotaExceededError }));
jest.mock('../../lib/queue', () => ({ scrapeQueue: { getJob: jest.fn() } }));

const ORG = '11111111-1111-1111-1111-111111111111';

function post() {
    const router = require('../scrape').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/' && l.route.methods.post);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

beforeEach(() => enqueueScrape.mockReset().mockResolvedValue(undefined));

describe('POST /api/scrape quota', () => {
    it('enqueues for the authenticated tenant, not a body-supplied one', async () => {
        const r = res();
        await post()({ organizationId: ORG, body: { url: 'https://a.example', organizationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' } }, r);
        expect(enqueueScrape.mock.calls[0][0]).toBe(ORG);
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ message: 'Scrape job enqueued' }));
    });

    it('answers 429 with the limit when the quota is exhausted', async () => {
        enqueueScrape.mockRejectedValue(new QuotaExceededError(100, 100));
        const r = res();
        await post()({ organizationId: ORG, body: { url: 'https://a.example' } }, r);
        expect(r.status).toHaveBeenCalledWith(429);
        expect(r.json).toHaveBeenCalledWith(expect.objectContaining({ limit: 100, used: 100 }));
    });

    it('refuses a caller with no tenant instead of queueing under a body-supplied one', async () => {
        const r = res();
        await post()({ body: { url: 'https://a.example', organizationId: '3fa85f64-5717-4562-b3fc-2c963f66afa6' } }, r);
        expect(r.status).toHaveBeenCalledWith(401);
        expect(enqueueScrape).not.toHaveBeenCalled();
    });
});

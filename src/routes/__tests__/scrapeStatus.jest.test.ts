export {};
// A job id alone must not be enough to read a scrape job: it has to belong to the caller's tenant.
const getJob = jest.fn();
jest.mock('../../lib/queue', () => ({ scrapeQueue: { getJob, add: jest.fn() } }));
jest.mock('../../lib/schemas', () => new Proxy({}, { get: () => ({ safeParse: (b: any) => ({ success: true, data: b }) }) }));

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

function statusHandler() {
    const router = require('../scrape').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/status/:jobId' && l.route.methods.get);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}
function mockRes() {
    const res: any = {};
    res.status = jest.fn(() => res);
    res.json = jest.fn(() => res);
    return res;
}
const jobOf = (organizationId?: string) => ({
    data: { organizationId },
    getState: async () => 'completed',
    progress: 100,
    returnvalue: { domain: 'secret.example' },
    failedReason: undefined,
});

beforeEach(() => getJob.mockReset());

describe('GET /api/scrape/status/:jobId', () => {
    it('returns the job to the tenant that owns it', async () => {
        getJob.mockResolvedValue(jobOf(ORG_A));
        const res = mockRes();
        await statusHandler()({ params: { jobId: 'j1' }, organizationId: ORG_A }, res);
        expect(res.status).not.toHaveBeenCalled();
        expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ jobId: 'j1', state: 'completed' }));
    });

    it("returns 404, the same as a missing job, for another tenant's job", async () => {
        getJob.mockResolvedValue(jobOf(ORG_A));
        const other = mockRes();
        await statusHandler()({ params: { jobId: 'j1' }, organizationId: ORG_B }, other);
        getJob.mockResolvedValue(null);
        const missing = mockRes();
        await statusHandler()({ params: { jobId: 'nope' }, organizationId: ORG_B }, missing);
        expect(other.status).toHaveBeenCalledWith(404);
        expect(other.json.mock.calls[0][0]).toEqual(missing.json.mock.calls[0][0]);
        expect(JSON.stringify(other.json.mock.calls)).not.toContain('secret.example');
    });

    it('does not match a job with no stored tenant to a caller with no tenant', async () => {
        getJob.mockResolvedValue(jobOf(undefined));
        const res = mockRes();
        await statusHandler()({ params: { jobId: 'j1' } }, res);
        expect(res.status).toHaveBeenCalledWith(401);
        expect(res.json).not.toHaveBeenCalledWith(expect.objectContaining({ state: 'completed' }));
    });

    it('hides a legacy job that has no stored tenant from every tenant', async () => {
        getJob.mockResolvedValue(jobOf(undefined));
        const res = mockRes();
        await statusHandler()({ params: { jobId: 'j1' }, organizationId: ORG_A }, res);
        expect(res.status).toHaveBeenCalledWith(404);
    });
});

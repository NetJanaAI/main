// The results list must not hand out raw stored screenshot paths: only short-lived signed links.
export {};
const queryWithOrg = jest.fn();
jest.mock('../../lib/database', () => ({ query: jest.fn(), queryWithOrg }));
jest.mock('../../lib/pdfReport', () => ({ generateReport: jest.fn() }));
jest.mock('../../lib/dataCapsule', () => ({ generateCapsule: jest.fn(), signCapsule: jest.fn() }));

const ORG_A = '11111111-1111-1111-1111-111111111111';

function listHandler() {
    const router = require('../results').default;
    const layer = router.stack.find((l: any) => l.route && l.route.path === '/' && l.route.methods.get);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

describe('GET /api/results', () => {
    it('returns signed screenshot links, not raw stored paths', async () => {
        queryWithOrg.mockResolvedValue({ rows: [
            { job_id: 'j1', domain: 'a.example', screenshot_path: '/screenshots/a_example_1.png' },
            { job_id: 'j2', domain: 'b.example', screenshot_path: null },
        ] });
        const res: any = { json: jest.fn(), status: jest.fn(() => res) };
        await listHandler()({ organizationId: ORG_A, query: {} }, res);
        const rows = res.json.mock.calls[0][0].data;
        expect(rows[0].screenshot_path).toMatch(/^\/screenshots\/a_example_1\.png\?exp=\d+&sig=[0-9a-f]{64}$/);
        expect(rows[1].screenshot_path).toBeNull();
    });
});

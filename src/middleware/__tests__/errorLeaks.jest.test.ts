export {};
const query = jest.fn();
const queryWithOrg = jest.fn();

jest.mock('../../lib/database', () => ({ query: (...a: any[]) => query(...a), queryWithOrg: (...a: any[]) => queryWithOrg(...a), db: { query } }));
jest.mock('../../lib/scheduler', () => ({ addSchedule: jest.fn(), removeSchedule: jest.fn(), listSchedules: jest.fn() }));
jest.mock('../../lib/pdfReport', () => ({ generateReport: jest.fn() }));
jest.mock('../../lib/dataCapsule', () => ({ generateCapsule: jest.fn(), signCapsule: jest.fn() }));

const DB_ERROR = 'relation "scrape_results" does not exist at character 15 (password authentication failed for user "app_owner")';
const res = () => { const r: any = {}; r.status = jest.fn(() => r); r.json = jest.fn(() => r); return r; };

beforeEach(() => {
    query.mockReset().mockRejectedValue(new Error(DB_ERROR));
    queryWithOrg.mockReset().mockRejectedValue(new Error(DB_ERROR));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('error responses do not reveal internals', () => {
    it('a failed list query returns a generic 500', async () => {
        const router = require('../../routes/schedules').default;
        const layer = router.stack.find((l: any) => l.route && l.route.path === '/' && l.route.methods.get);
        const r = res();
        await layer.route.stack[0].handle({ organizationId: '11111111-1111-1111-1111-111111111111' }, r);
        expect(r.status).toHaveBeenCalledWith(500);
        expect(JSON.stringify(r.json.mock.calls)).not.toMatch(/scrape_results|password|app_owner/);
    });

    it('the global handler hides name, code and message in production', () => {
        const { errorHandler } = require('../error-handler');
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const r = res();
        const err: any = Object.assign(new Error(DB_ERROR), { name: 'error', code: '42P01', status: 500 });
        errorHandler(err, { url: '/x', method: 'GET' }, r, jest.fn());
        process.env.NODE_ENV = env;
        const body = r.json.mock.calls[0][0];
        expect(body).toEqual(expect.objectContaining({ error: 'InternalServerError', code: 'UNKNOWN_ERROR' }));
        expect(JSON.stringify(body)).not.toMatch(/42P01|password|scrape_results/);
    });

    it('the global handler keeps a 4xx status so clients can tell what they did wrong', () => {
        const { errorHandler } = require('../error-handler');
        const env = process.env.NODE_ENV;
        process.env.NODE_ENV = 'production';
        const r = res();
        errorHandler(Object.assign(new Error('bad'), { status: 400 }), { url: '/x', method: 'GET' }, r, jest.fn());
        process.env.NODE_ENV = env;
        expect(r.status).toHaveBeenCalledWith(400);
    });
});

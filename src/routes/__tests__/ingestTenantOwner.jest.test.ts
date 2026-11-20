const add = jest.fn().mockResolvedValue({});

jest.mock('../../lib/queue', () => ({ rawSignalsQueue: { add: (...a: any[]) => add(...a) } }));
jest.mock('../../lib/cache', () => ({ cache: { set: jest.fn().mockResolvedValue('OK') } }));
jest.mock('../../middleware/ingestAuth', () => ({
    ingestAuthGuard: (_req: any, _res: any, next: () => void) => next(),
}));

import router from '../ingest';

const TENANT = '11111111-1111-1111-1111-111111111111';

function handlerFor(path: string) {
    const layer = (router as any).stack.find((l: any) => l.route?.path === path && l.route.methods.post);
    return layer.route.stack[layer.route.stack.length - 1].handle;
}

function res() {
    const r: any = {};
    r.status = jest.fn().mockReturnValue(r);
    r.json = jest.fn().mockReturnValue(r);
    return r;
}

describe('ingested signals carry the ingesting tenant', () => {
    beforeEach(() => add.mockClear());

    it('queues a GeM signal owned by the authenticated tenant', async () => {
        const soon = new Date(Date.now() + 3 * 86400_000).toISOString();
        const req: any = {
            organizationId: TENANT,
            body: {
                bid_id: 'B-1', buyer_name: 'Acme Steel', ministry_state: 'MH',
                department: 'Works', bid_deadline: soon, item_category: 'Steel',
            },
        };
        const r = res();
        await handlerFor('/gem')(req, r);

        expect(r.status).toHaveBeenCalledWith(201);
        expect(add).toHaveBeenCalledTimes(1);
        expect(add.mock.calls[0][1].tenant_id).toBe(TENANT);
    });
});

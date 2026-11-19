export {};
const queryWithOrg = jest.fn();
jest.mock('../../lib/database', () => ({ queryWithOrg: (...a: any[]) => queryWithOrg(...a) }));
jest.mock('../../lib/secrets', () => ({ getHmacSecret: () => 'secret' }));

import { csvField } from '../../lib/csv';

describe('csvField', () => {
    it('defuses spreadsheet formulas', () => {
        for (const v of ['=SUM(A1)', '+1', '-1', '@cmd', '  =1+1']) expect(csvField(v).startsWith("'")).toBe(true);
    });

    it('quotes values that contain commas, quotes or line breaks', () => {
        expect(csvField('a,b')).toBe('"a,b"');
        expect(csvField('say "hi"')).toBe('"say ""hi"""');
        expect(csvField('line1\nline2')).toBe('"line1\nline2"');
    });

    it('leaves ordinary values and numbers alone, and turns null into an empty field', () => {
        expect(csvField('acme.com')).toBe('acme.com');
        expect(csvField(42)).toBe('42');
        expect(csvField(null)).toBe('');
    });
});

describe('vault export', () => {
    it('does not let a scraped domain become a formula or add columns', async () => {
        queryWithOrg.mockResolvedValue({ rows: [{ domain: '=HYPERLINK("http://evil","x"),extra', friction_score: 5, geo_country: 'IN', estimated_roi: 10, timestamp: '2026-01-01' }] });
        const router = require('../vault').default;
        const layer = router.stack.find((l: any) => l.route && l.route.methods.get);
        const sent: string[] = [];
        const r: any = { status: jest.fn(() => r), json: jest.fn(() => r), setHeader: jest.fn(), send: jest.fn((b: string) => sent.push(b)) };
        await layer.route.stack[layer.route.stack.length - 1].handle({ organizationId: '11111111-1111-1111-1111-111111111111', query: {} }, r);
        const dataLine = sent[0].split('\n').find((l) => l.includes('HYPERLINK'))!;
        expect(dataLine.startsWith('"\'=HYPERLINK')).toBe(true);
        expect(dataLine.endsWith(',5,IN,10,2026-01-01')).toBe(true);
    });
});

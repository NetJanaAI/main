import crypto from 'crypto';

const post = jest.fn();
jest.mock('axios', () => ({ __esModule: true, default: { post } }));

import { RazorpayService } from '../RazorpayService';

describe('RazorpayService.createSubscription', () => {
    it('sends plan, count and notes only (customer_id is not a create parameter)', async () => {
        post.mockResolvedValue({ data: { id: 'sub_1' } });
        await RazorpayService.createSubscription('plan_x', { organizationId: 'org-1' });
        const [url, body] = post.mock.calls[0];
        expect(url).toMatch(/\/subscriptions$/);
        expect(body).toEqual({ plan_id: 'plan_x', total_count: 12, quantity: 1, customer_notify: true, notes: { organizationId: 'org-1' } });
    });
});

describe('RazorpayService.verifyWebhook', () => {
    const raw = Buffer.from('{"a":1}');
    const sig = (secret: string) => crypto.createHmac('sha256', secret).update(raw).digest('hex');
    afterEach(() => { delete process.env.RAZORPAY_WEBHOOK_SECRET; });

    it('accepts the correct signature over the raw bytes', () => {
        process.env.RAZORPAY_WEBHOOK_SECRET = 's';
        expect(RazorpayService.verifyWebhook(raw, sig('s'))).toBe(true);
    });
    it('rejects wrong, short or undefined signatures', () => {
        process.env.RAZORPAY_WEBHOOK_SECRET = 's';
        expect(RazorpayService.verifyWebhook(raw, sig('x'))).toBe(false);
        expect(RazorpayService.verifyWebhook(raw, 'ab')).toBe(false);
        expect(RazorpayService.verifyWebhook(raw, undefined)).toBe(false);
    });
    it('rejects everything when no secret is set', () => {
        expect(RazorpayService.verifyWebhook(raw, sig(''))).toBe(false);
    });
});

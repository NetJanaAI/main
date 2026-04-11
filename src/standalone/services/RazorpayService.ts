import axios from 'axios';
import crypto from 'crypto';

export interface RazorpaySubscription {
    id: string;
    status: string;
    plan_id: string;
    current_end: number;
}

export class RazorpayService {
    private static KEY_ID = process.env.RAZORPAY_KEY_ID;
    private static KEY_SECRET = process.env.RAZORPAY_KEY_SECRET;
    private static BASE_URL = 'https://api.razorpay.com/v1';

    private static get auth() {
        return {
            username: this.KEY_ID || '',
            password: this.KEY_SECRET || ''
        };
    }

    /**
     * Creates a customer in Razorpay and links to organizationId.
     */
    static async createCustomer(organizationId: string, email: string, name: string) {
        try {
            const res = await axios.post(`${this.BASE_URL}/customers`, {
                name,
                email,
                notes: { organizationId }
            }, { auth: this.auth });
            return res.data;
        } catch (e: any) {
            console.error('[Razorpay] Customer creation failed:', e.response?.data || e.message);
            throw e;
        }
    }

    /**
     * Creates a subscription for a given plan.
     */
    static async createSubscription(customerId: string, planId: string) {
        try {
            const res = await axios.post(`${this.BASE_URL}/subscriptions`, {
                plan_id: planId,
                customer_id: customerId,
                total_count: 12, // 1 year of monthly billing
                quantity: 1,
                addons: []
            }, { auth: this.auth });
            return res.data;
        } catch (e: any) {
            console.error('[Razorpay] Subscription creation failed:', e.response?.data || e.message);
            throw e;
        }
    }

    /**
     * Verifies webhook signature for payment/subscription updates.
     */
    static verifyWebhook(payload: string, signature: string): boolean {
        const expectedSignature = crypto
            .createHmac('sha256', process.env.RAZORPAY_WEBHOOK_SECRET || '')
            .update(payload)
            .digest('hex');
        return expectedSignature === signature;
    }

    /**
     * Syncs usage (e.g. extra scrapes) for metered billing.
     * Razorpay doesn't have a direct "metered" API like Stripe, 
     * but we can use "Add-ons" or manual "Orders" for top-ups.
     */
    static async billExtraUsage(subscriptionId: string, amount: number, description: string) {
        try {
            // Creating an addon for the current subscription cycle
            const res = await axios.post(`${this.BASE_URL}/subscriptions/${subscriptionId}/addons`, {
                item: {
                    name: description,
                    amount: amount * 100, // In paise
                    currency: 'INR'
                }
            }, { auth: this.auth });
            return res.data;
        } catch (e: any) {
             console.error('[Razorpay] Failed to bill extra usage:', e.response?.data || e.message);
             throw e;
        }
    }

    /**
     * Generates a GST-compliant invoice for an order.
     */
    static async createInvoice(customerId: string, orderId: string, items: any[]) {
        try {
            const res = await axios.post(`${this.BASE_URL}/invoices`, {
                customer_id: customerId,
                order_id: orderId,
                type: 'invoice',
                description: 'NetJana AI Service Subscription',
                line_items: items.map(i => ({
                    name: i.name,
                    amount: i.amount * 100,
                    currency: 'INR'
                })),
                sms_notify: 1,
                email_notify: 1
            }, { auth: this.auth });
            return res.data;
        } catch (e: any) {
            console.error('[Razorpay] Invoice generation failed:', e.response?.data || e.message);
            throw e;
        }
    }
}

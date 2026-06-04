jest.mock('../../../lib/database', () => ({
    query: jest.fn(),
}));

jest.mock('../../../utils/logger', () => ({
    SecureLogger: {
        maskPII: jest.fn((value: string) => value),
    },
}));

describe('OutreachDispatcher', () => {
    const originalEnv = process.env;

    afterEach(() => {
        process.env = originalEnv;
        jest.resetModules();
    });

    it('marks email dispatch as unconfigured when SMTP credentials are absent', async () => {
        process.env = { NODE_ENV: 'test' };
        const { OutreachDispatcher } = await import('../OutreachDispatcher');
        const dispatcher = new OutreachDispatcher();

        const result = await dispatcher.dispatch(
            'EMAIL',
            { coldEmail: { subject: 'Hello', body: 'Body' } },
            { leadId: '00000000-0000-0000-0000-000000000001', contactEmail: 'buyer@example.com' }
        );

        expect(result).toEqual(expect.objectContaining({
            success: false,
            channel: 'EMAIL',
            unconfigured: true,
        }));
    });

    it('refuses placeholder recipient email addresses', async () => {
        process.env = {
            NODE_ENV: 'test',
            SMTP_HOST: 'smtp.example.com',
            SMTP_USER: 'user',
            SMTP_PASS: 'pass',
        };
        const { OutreachDispatcher } = await import('../OutreachDispatcher');
        const dispatcher = new OutreachDispatcher();

        const result = await dispatcher.dispatch(
            'EMAIL',
            { coldEmail: { subject: 'Hello', body: 'Body' } },
            { leadId: '00000000-0000-0000-0000-000000000001', contactEmail: 'recipient@example.com' }
        );

        expect(result).toEqual(expect.objectContaining({
            success: false,
            channel: 'EMAIL',
            error: expect.stringContaining('placeholder'),
        }));
    });
});

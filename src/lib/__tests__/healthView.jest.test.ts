import { healthView } from '../telemetry';

const full = {
    status: 'DEGRADED',
    timestamp: 't',
    mode: { nodeEnv: 'production' },
    checks: [{ component: 'Production Config', error: 'Missing required production configuration: CLERK_SECRET_KEY' }],
};

describe('healthView', () => {
    afterEach(() => { delete process.env.METRICS_BEARER_TOKEN; });

    it('shows only status and timestamp to anonymous callers', () => {
        process.env.METRICS_BEARER_TOKEN = 'tok';
        expect(healthView(full, undefined)).toEqual({ status: 'DEGRADED', timestamp: 't' });
        expect(healthView(full, 'Bearer wrong')).toEqual({ status: 'DEGRADED', timestamp: 't' });
    });

    it('shows the detail to a caller with the token', () => {
        process.env.METRICS_BEARER_TOKEN = 'tok';
        expect(healthView(full, 'Bearer tok')).toBe(full);
    });

    it('never shows detail when no token is configured', () => {
        expect(healthView(full, 'Bearer undefined')).toEqual({ status: 'DEGRADED', timestamp: 't' });
    });
});

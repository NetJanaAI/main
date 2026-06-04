import { cidrContains } from '../ingestAuth';

jest.mock('../../lib/database', () => ({
    query: jest.fn(),
}));

jest.mock('../../lib/secrets', () => ({
    DEV_HMAC_SECRET: 'dev-secret',
    getHmacSecret: jest.fn(() => 'hash-secret'),
}));

describe('cidrContains', () => {
    it('matches a client IP inside an IPv4 CIDR block', () => {
        expect(cidrContains('203.0.113.0/24', '203.0.113.45')).toBe(true);
    });

    it('does not match a client IP outside an IPv4 CIDR block', () => {
        expect(cidrContains('203.0.113.0/24', '203.0.114.45')).toBe(false);
    });

    it('still supports exact host entries', () => {
        expect(cidrContains('198.51.100.10', '198.51.100.10')).toBe(true);
        expect(cidrContains('198.51.100.10', '198.51.100.11')).toBe(false);
    });

    it('fails closed for malformed allowlist entries', () => {
        expect(cidrContains('not-a-cidr', '203.0.113.45')).toBe(false);
    });
});

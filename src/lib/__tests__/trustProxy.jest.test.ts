import { parseTrustProxy } from '../trustProxy';

describe('parseTrustProxy', () => {
    beforeEach(() => jest.spyOn(console, 'warn').mockImplementation(() => {}));
    afterEach(() => jest.restoreAllMocks());

    it('trusts nothing when unset or false', () => {
        expect(parseTrustProxy(undefined)).toBe(false);
        expect(parseTrustProxy('')).toBe(false);
        expect(parseTrustProxy(' false ')).toBe(false);
    });

    it('reads a hop count', () => {
        expect(parseTrustProxy('1')).toBe(1);
        expect(parseTrustProxy(' 2 ')).toBe(2);
    });

    it('passes a list of proxy addresses through', () => {
        expect(parseTrustProxy('loopback, 10.0.0.0/8')).toBe('loopback, 10.0.0.0/8');
    });

    it('refuses to trust every proxy', () => {
        expect(parseTrustProxy('true')).toBe(false);
    });
});

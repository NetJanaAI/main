import { cleanCompanyName, getPhoneticKey, resolveEntity, resolveEntitySafe } from '../entity-resolver';
import { cache } from '../../lib/cache';
import { query } from '../../lib/database';

jest.mock('double-metaphone', () => ({
    doubleMetaphone: jest.fn((word: string) => [word.toUpperCase().slice(0, 4), ''])
}));

jest.mock('../../lib/cache', () => ({
    cache: {
        get: jest.fn(),
        set: jest.fn()
    }
}));

jest.mock('../../lib/database', () => ({
    query: jest.fn()
}));


describe('Entity Resolver Compiler Agent', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    describe('cleanCompanyName', () => {
        it('should strip legal suffixes', () => {
            expect(cleanCompanyName('Acme Solutions Pvt Ltd')).toBe('ACME');
            expect(cleanCompanyName('Global Logistics Private Limited,')).toBe('GLOBAL LOGISTICS');
            expect(cleanCompanyName('Apex Tech LLC')).toBe('APEX');
            expect(cleanCompanyName('Bharat Heavy Electricals Limited')).toBe('BHARAT HEAVY ELECTRICALS');
        });

        it('should remove industry noise words when other words remain', () => {
            expect(cleanCompanyName('Titan Trading Enterprises')).toBe('TITAN');
            expect(cleanCompanyName('Reliance Industries Global')).toBe('RELIANCE');
            expect(cleanCompanyName('Zenith Technologies Services')).toBe('ZENITH');
        });

        it('should normalize special characters and whitespace', () => {
            expect(cleanCompanyName('  A-B-C & Sons (India) Corp  ')).toBe('ABC SONS INDIA');
        });

    });

    describe('getPhoneticKey', () => {
        it('should return double metaphone phonetic keys joined by dash', () => {
            const key = getPhoneticKey('ACME LOGISTICS');
            expect(key).toBeTruthy();
            expect(typeof key).toBe('string');
            expect(key).toContain('-');
        });
    });

    describe('resolveEntity (Database & Cache Integration)', () => {
        it('should return cached orgId on exact match cache hit', async () => {
            (cache.get as jest.Mock).mockResolvedValue('org_cached_123');
            (query as jest.Mock).mockResolvedValue({ rows: [] });

            const orgId = await resolveEntity('Acme Corp', 'MH');
            expect(orgId).toBe('org_cached_123');
            expect(cache.get).toHaveBeenCalled();
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('UPDATE org_registry SET last_signal_at'),
                ['org_cached_123']
            );
        });

        it('should query Postgres exact match when cache misses and cache the result', async () => {
            (cache.get as jest.Mock).mockResolvedValue(null);
            (query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ org_id: 'org_db_exact_456' }] }) // exact lookup
                .mockResolvedValueOnce({ rows: [] }); // touchOrgLastSeen

            const orgId = await resolveEntity('Acme Corp', 'MH');
            expect(orgId).toBe('org_db_exact_456');
            expect(cache.set).toHaveBeenCalledWith(
                'entity:exact:ACME:MH',
                'org_db_exact_456',
                { ex: 86400 }
            );
        });

        it('should fallback to stable local ID when no exact, CIN, or phonetic match exists', async () => {
            (cache.get as jest.Mock).mockResolvedValue(null);
            (query as jest.Mock)
                .mockResolvedValueOnce({ rows: [] }) // exact lookup
                .mockResolvedValueOnce({ rows: [] }) // phonetic lookup
                .mockResolvedValueOnce({ rows: [] }); // registerOrg INSERT

            const orgId = await resolveEntity('Unique Brand New Company', 'DL');
            expect(orgId).toMatch(/^local_[a-f0-9]{12}$/);
            expect(cache.set).toHaveBeenCalled();
        });
    });

    describe('resolveEntitySafe (Advisory Lock Safety)', () => {
        it('should acquire advisory lock, resolve entity, and release lock', async () => {
            (query as jest.Mock)
                .mockResolvedValueOnce({ rows: [{ pg_try_advisory_lock: true }] }) // lock acquire
                .mockResolvedValueOnce({ rows: [{ org_id: 'org_safe_789' }] })     // exact lookup
                .mockResolvedValueOnce({ rows: [] })                              // touchOrgLastSeen
                .mockResolvedValueOnce({ rows: [{ pg_advisory_unlock: true }] }); // unlock

            (cache.get as jest.Mock).mockResolvedValue(null);

            const orgId = await resolveEntitySafe('Acme Safe', 'KA');
            expect(orgId).toBe('org_safe_789');
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('pg_try_advisory_lock'),
                expect.any(Array)
            );
            expect(query).toHaveBeenCalledWith(
                expect.stringContaining('pg_advisory_unlock'),
                expect.any(Array)
            );
        });

        it('should retry if advisory lock fails up to MAX_LOCK_RETRIES limit', async () => {
            (cache.get as jest.Mock).mockResolvedValue('org_cached_fallback');
            (query as jest.Mock).mockResolvedValue({ rows: [{ pg_try_advisory_lock: false }] });

            const consoleSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});

            const orgId = await resolveEntitySafe('Locked Company', 'MH', null, null, null, null, 10);
            expect(orgId).toBe('org_cached_fallback');
            expect(consoleSpy).toHaveBeenCalledWith(
                expect.stringContaining('Advisory lock exhausted after 10 retries')
            );
            consoleSpy.mockRestore();
        });
    });
});

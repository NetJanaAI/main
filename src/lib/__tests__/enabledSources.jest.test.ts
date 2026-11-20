import { enabledSourcesFrom, ALL_SOURCES } from '../enabledSources';

describe('enabledSourcesFrom', () => {
    it('enables every source for a tenant that has never configured any', () => {
        expect(enabledSourcesFrom([])).toEqual(ALL_SOURCES);
    });

    it('returns only the enabled sources once the tenant has configured some', () => {
        const rows = [
            { source_id: 'gem', is_enabled: true },
            { source_id: 'mca', is_enabled: false },
        ];
        expect(enabledSourcesFrom(rows)).toEqual(['gem']);
    });

    it('keeps an explicit all-disabled configuration empty', () => {
        const rows = [
            { source_id: 'gem', is_enabled: false },
            { source_id: 'webscrape', is_enabled: false },
        ];
        expect(enabledSourcesFrom(rows)).toEqual([]);
    });
});

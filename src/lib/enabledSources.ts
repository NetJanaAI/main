export const ALL_SOURCES = ['indiamart', 'gem', 'mca', 'zauba', 'webscrape', 'funding', 'naukri', 'rera', 'parivesh'];

export interface SourceConfigRow {
    source_id: string;
    is_enabled: boolean;
}

// A tenant with no configuration at all gets every source; once it has any, only the enabled ones count,
// so switching every source off is respected.
export function enabledSourcesFrom(rows: SourceConfigRow[]): string[] {
    if (rows.length === 0) return ALL_SOURCES;
    return rows.filter((r) => r.is_enabled).map((r) => r.source_id);
}

/** Neutralises a leading formula character so a spreadsheet does not run the cell as a formula. */
export function escapeCsvValue(val: string): string {
    const trimmed = (val || '').trim();
    if (trimmed.startsWith('=') || trimmed.startsWith('+') || trimmed.startsWith('-') || trimmed.startsWith('@')) {
        return `'${trimmed}`;
    }
    return val || '';
}

/** A CSV field that is safe to open in a spreadsheet and cannot break out of its column or row. */
export function csvField(value: unknown): string {
    const text = escapeCsvValue(value === null || value === undefined ? '' : String(value));
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

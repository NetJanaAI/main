/**
 * TOON (Token-Oriented Object Notation)
 * A compact, tabular serialization format for reducing token count in LLM prompts.
 * Declares headers once, then rows of data.
 */

export function jsonToToon(data: any): string {
    if (!data || typeof data !== 'object') return String(data);

    if (Array.isArray(data)) {
        if (data.length === 0) return '[]';
        
        // Check if it's a uniform array of objects (perfect for TOON)
        const first = data[0];
        if (typeof first === 'object' && !Array.isArray(first)) {
            const keys = Object.keys(first);
            const header = `| ${keys.join(' | ')} |`;
            const rows = data.map(item => {
                const vals = keys.map(k => {
                    const v = item[k];
                    return typeof v === 'object' ? JSON.stringify(v).replace(/\|/g, '\\|') : String(v).replace(/\|/g, '\\|');
                });
                return `| ${vals.join(' | ')} |`;
            });
            return [header, ...rows].join('\n');
        }
        
        return data.map(v => jsonToToon(v)).join('\n---\n');
    }

    // For single objects, use a key:val compact list or single-row table
    const keys = Object.keys(data);
    const header = `| ${keys.join(' | ')} |`;
    const row = `| ${keys.map(k => {
        const v = data[k];
        return typeof v === 'object' ? JSON.stringify(v).replace(/\|/g, '\\|') : String(v).replace(/\|/g, '\\|');
    }).join(' | ')} |`;

    return `${header}\n${row}`;
}

/**
 * Basic TOON parser (Reverse conversion)
 */
export function toonToJson(toon: string): any {
    const lines = toon.trim().split('\n');
    if (lines.length < 2) return toon;

    const parseRow = (line: string) => line.split('|').filter(s => s.trim() !== '').map(s => s.trim());
    const headers = parseRow(lines[0]);
    const results = lines.slice(1).map(line => {
        const values = parseRow(line);
        const obj: any = {};
        headers.forEach((h, i) => {
            let val = values[i] || '';
            try {
                if (val.startsWith('{') || val.startsWith('[')) val = JSON.parse(val);
            } catch (_) {}
            obj[h] = val;
        });
        return obj;
    });

    return results.length === 1 ? results[0] : results;
}

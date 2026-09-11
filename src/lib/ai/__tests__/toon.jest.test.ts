import { jsonToToon, toonToJson } from '../toon';

describe('TOON (Token-Oriented Object Notation) Serializer', () => {
    describe('jsonToToon', () => {
        it('should return string representation for primitive or non-object values', () => {
            expect(jsonToToon('hello')).toBe('hello');
            expect(jsonToToon(123)).toBe('123');
            expect(jsonToToon(null)).toBe('null');
            expect(jsonToToon(undefined)).toBe('undefined');
        });

        it('should format a single object as a compact markdown table', () => {
            const input = { name: 'Acme Corp', industry: 'Logistics', score: 85 };
            const result = jsonToToon(input);
            expect(result).toBe('| name | industry | score |\n| Acme Corp | Logistics | 85 |');
        });

        it('should format a uniform array of objects as a multi-row markdown table', () => {
            const input = [
                { company: 'Alpha Inc', region: 'India' },
                { company: 'Beta LLC', region: 'UAE' }
            ];
            const result = jsonToToon(input);
            expect(result).toBe('| company | region |\n| Alpha Inc | India |\n| Beta LLC | UAE |');
        });

        it('should handle empty array', () => {
            expect(jsonToToon([])).toBe('[]');
        });

        it('should escape pipe characters inside string values', () => {
            const input = { note: 'Quality | High | Priority' };
            const result = jsonToToon(input);
            expect(result).toContain('Quality \\| High \\| Priority');
        });

        it('should serialize nested object values into JSON strings', () => {
            const input = { meta: { geo: 'IN', tier: 1 } };
            const result = jsonToToon(input);
            expect(result).toContain('{"geo":"IN","tier":1}');
        });

        it('should join non-object array items with horizontal rules', () => {
            const input = ['signal 1', 'signal 2'];
            const result = jsonToToon(input);
            expect(result).toBe('signal 1\n---\nsignal 2');
        });
    });

    describe('toonToJson', () => {
        it('should parse a single-row TOON table back into an object', () => {
            const toon = '| name | industry |\n| Acme Corp | Logistics |';
            const result = toonToJson(toon);
            expect(result).toEqual({ name: 'Acme Corp', industry: 'Logistics' });
        });

        it('should parse a multi-row TOON table back into an array of objects', () => {
            const toon = '| company | region |\n| Alpha Inc | India |\n| Beta LLC | UAE |';
            const result = toonToJson(toon);
            expect(result).toEqual([
                { company: 'Alpha Inc', region: 'India' },
                { company: 'Beta LLC', region: 'UAE' }
            ]);
        });

        it('should parse nested JSON strings inside table cells', () => {
            const toon = '| id | meta |\n| 101 | {"geo":"IN","tier":1} |';
            const result = toonToJson(toon);
            expect(result).toEqual({ id: '101', meta: { geo: 'IN', tier: 1 } });
        });

        it('should return original text if format does not have header/data lines', () => {
            const plainText = 'Just a simple string';
            expect(toonToJson(plainText)).toBe(plainText);
        });
    });
});

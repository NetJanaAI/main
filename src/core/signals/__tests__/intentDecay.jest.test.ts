import { calculateDecay } from '../intentDecay';

describe('calculateDecay', () => {
    beforeEach(() => {
        jest.useFakeTimers().setSystemTime(new Date('2026-06-04T00:00:00.000Z'));
    });

    afterEach(() => {
        jest.useRealTimers();
    });

    it('keeps a fresh high-intent signal hot', () => {
        const result = calculateDecay(100, new Date('2026-06-04T00:00:00.000Z'));

        expect(result.decayedScore).toBe(100);
        expect(result.freshnessPercent).toBe(100);
        expect(result.status).toBe('Hot');
        expect(result.daysSince).toBe(0);
    });

    it('applies the 30 day half-life to scoring', () => {
        const result = calculateDecay(100, new Date('2026-05-05T00:00:00.000Z'));

        expect(result.decayedScore).toBe(50);
        expect(result.freshnessPercent).toBe(50);
        expect(result.status).toBe('Cold');
        expect(result.daysSince).toBe(30);
    });

    it('classifies warm and dead thresholds consistently', () => {
        expect(calculateDecay(80, new Date('2026-06-04T00:00:00.000Z')).status).toBe('Warm');
        expect(calculateDecay(20, new Date('2026-06-04T00:00:00.000Z')).status).toBe('Dead');
    });
});

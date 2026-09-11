import { cleanCompanyName } from '../../lib/text-utils';
import { GetCINCandidate } from './types';

/**
 * Calculates the Jaro similarity between two strings.
 */
function jaroDistance(s1: string, s2: string): number {
    if (s1 === s2) return 1.0;
    const len1 = s1.length;
    const len2 = s2.length;
    if (len1 === 0 || len2 === 0) return 0.0;

    const matchWindow = Math.max(0, Math.floor(Math.max(len1, len2) / 2) - 1);
    const s1Matches = new Array(len1).fill(false);
    const s2Matches = new Array(len2).fill(false);

    let matches = 0;
    for (let i = 0; i < len1; i++) {
        const start = Math.max(0, i - matchWindow);
        const end = Math.min(i + matchWindow + 1, len2);
        for (let j = start; j < end; j++) {
            if (s2Matches[j]) continue;
            if (s1[i] !== s2[j]) continue;
            s1Matches[i] = true;
            s2Matches[j] = true;
            matches++;
            break;
        }
    }

    if (matches === 0) return 0.0;

    let transpositions = 0;
    let k = 0;
    for (let i = 0; i < len1; i++) {
        if (!s1Matches[i]) continue;
        while (!s2Matches[k]) k++;
        if (s1[i] !== s2[k]) transpositions++;
        k++;
    }

    const m = matches;
    const t = transpositions / 2;
    return (m / len1 + m / len2 + (m - t) / m) / 3.0;
}

/**
 * Calculates Jaro-Winkler similarity (0.0 to 1.0).
 */
export function jaroWinkler(s1: string, s2: string, prefixScale: number = 0.1): number {
    const jaro = jaroDistance(s1, s2);
    if (jaro < 0.7) return jaro;

    let prefixLength = 0;
    const maxPrefix = Math.min(4, Math.min(s1.length, s2.length));
    for (let i = 0; i < maxPrefix; i++) {
        if (s1[i] === s2[i]) prefixLength++;
        else break;
    }

    return jaro + prefixLength * prefixScale * (1 - jaro);
}

/**
 * Calculates Levenshtein edit distance between two strings.
 */
function levenshteinDistance(s1: string, s2: string): number {
    const m = s1.length;
    const n = s2.length;
    if (m === 0) return n;
    if (n === 0) return m;

    let prevRow = new Array(n + 1);
    let currRow = new Array(n + 1);

    for (let j = 0; j <= n; j++) prevRow[j] = j;

    for (let i = 1; i <= m; i++) {
        currRow[0] = i;
        const char1 = s1[i - 1];
        for (let j = 1; j <= n; j++) {
            const char2 = s2[j - 1];
            const cost = char1 === char2 ? 0 : 1;
            currRow[j] = Math.min(
                prevRow[j] + 1,       // deletion
                currRow[j - 1] + 1,   // insertion
                prevRow[j - 1] + cost // substitution
            );
        }
        [prevRow, currRow] = [currRow, prevRow];
    }

    return prevRow[n];
}

/**
 * Token Sort Ratio: splits strings into tokens, sorts them alphabetically,
 * and calculates normalized Levenshtein similarity (0.0 to 1.0).
 */
export function tokenSortRatio(s1: string, s2: string): number {
    if (!s1 || !s2) return 0.0;
    const t1 = s1.split(/\s+/).filter(Boolean).sort().join(' ');
    const t2 = s2.split(/\s+/).filter(Boolean).sort().join(' ');
    if (t1 === t2) return 1.0;

    const maxLen = Math.max(t1.length, t2.length);
    if (maxLen === 0) return 1.0;

    const dist = levenshteinDistance(t1, t2);
    return Math.max(0, 1.0 - (dist / maxLen));
}

/**
 * Composite score combining Jaro-Winkler (0.45) and Token Sort Ratio (0.55).
 */
export function compositeScore(name1: string, name2: string): number {
    const c1 = cleanCompanyName(name1);
    const c2 = cleanCompanyName(name2);

    if (!c1 || !c2) return 0.0;
    if (c1 === c2) return 1.0;

    const jw = jaroWinkler(c1, c2);
    const tsr = tokenSortRatio(c1, c2);

    const score = 0.45 * jw + 0.55 * tsr;
    return Number(score.toFixed(4));
}

/**
 * Ranks candidates by composite similarity to queryName and selects the highest scoring candidate above threshold.
 */
export function selectBestCandidate(
    queryName: string,
    candidates: GetCINCandidate[],
    threshold: number = 0.85
): GetCINCandidate | null {
    if (!candidates || candidates.length === 0) return null;

    const scored = candidates.map(candidate => ({
        ...candidate,
        score: compositeScore(queryName, candidate.CompanyName)
    }));

    scored.sort((a, b) => (b.score || 0) - (a.score || 0));

    const top = scored[0];
    if (top && (top.score || 0) >= threshold) {
        return top;
    }

    return null;
}

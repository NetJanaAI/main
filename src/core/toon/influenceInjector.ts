import { InfluenceMap } from "../signals/influenceScorer";

/**
 * TOON Influence Injector
 * Extracts peak credibility hooks from the Influence Map for outreach generation.
 */
export function injectInfluenceContext(influenceMap: InfluenceMap | null): string {
    if (!influenceMap) return "[TOON:INFLUENCE_CONTEXT]\nwarm_entry_points: None mapped\n[/TOON]";

    const tradeBodies = (influenceMap.tradeBodies || [])
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, 2);
    
    const events = (influenceMap.events || [])
        .sort((a, b) => b.year - a.year)
        .slice(0, 1);

    const touchpoints = [...tradeBodies, ...events];

    return `[TOON:INFLUENCE_CONTEXT]
warm_entry_points:
${touchpoints.map(t => `  - ${t.name} (${(t as any).membershipType || (t as any).role}) — use as opening hook if relevant`).join('\n')}
rule: reference ONE of these in the cold email opener if it adds credibility
[/TOON]`;
}

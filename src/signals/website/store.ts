import { queryWithOrg, withOrgTransaction } from '../../lib/database';
import type { Observation, SignalKey } from './catalog';

export const OBSERVATION_TTL_DAYS = 30;

export interface CohortFilter {
    mustHave: SignalKey[];
    mustNotHave: SignalKey[];
    ranges: { key: SignalKey; min?: number; max?: number }[];
}

export interface PullSignal {
    signal_key: SignalKey;
    value: unknown;
    evidence_url: string | null;
    observed_at: string;
}

export async function getConfirmed(organizationId: string): Promise<SignalKey[]> {
    const res = await queryWithOrg(
        'SELECT signal_key FROM signal_confirmations WHERE organization_id = $1 ORDER BY signal_key',
        [organizationId],
        organizationId
    );
    return res.rows.map((r: any) => r.signal_key);
}

/** Replaces the tenant's confirmed set; collection only ever runs for these keys. */
export async function setConfirmed(organizationId: string, keys: SignalKey[]): Promise<void> {
    await withOrgTransaction(organizationId, async (client) => {
        await client.query('DELETE FROM signal_confirmations WHERE organization_id = $1', [organizationId]);
        if (keys.length > 0) {
            await client.query(
                'INSERT INTO signal_confirmations (organization_id, signal_key) SELECT $1, k FROM unnest($2::text[]) AS k',
                [organizationId, keys]
            );
        }
    });
}

export async function saveObservations(organizationId: string, domain: string, observations: Observation[]): Promise<void> {
    if (observations.length === 0) return;
    await queryWithOrg(
        `INSERT INTO signal_observation (organization_id, company_domain, signal_key, value, evidence_url, observed_at, expires_at)
         SELECT $1, $2, t.k, t.v::jsonb, t.e, NOW(), NOW() + make_interval(days => $6)
         FROM unnest($3::text[], $4::text[], $5::text[]) AS t(k, v, e)`,
        [
            organizationId,
            domain,
            observations.map((o) => o.key),
            observations.map((o) => JSON.stringify(o.value)),
            observations.map((o) => o.evidenceUrl),
            OBSERVATION_TTL_DAYS,
        ],
        organizationId
    );
}

/** How many companies currently have each signal observed (present or not), for the catalog. */
export async function observedCounts(organizationId: string): Promise<Record<string, number>> {
    const res = await queryWithOrg(
        `SELECT signal_key, COUNT(DISTINCT company_domain)::int AS n
         FROM signal_observation
         WHERE organization_id = $1 AND expires_at > NOW()
         GROUP BY signal_key`,
        [organizationId],
        organizationId
    );
    return Object.fromEntries(res.rows.map((r: any) => [r.signal_key, r.n]));
}

/**
 * Companies matching every condition, judged on each signal's latest unexpired observation.
 * must_have means observed and present; must_not_have means observed and absent.
 */
export async function cohort(organizationId: string, filter: CohortFilter, limit = 100): Promise<{ count: number; domains: string[] }> {
    const res = await queryWithOrg(
        `WITH latest AS (
             SELECT DISTINCT ON (company_domain, signal_key) company_domain, signal_key, value
             FROM signal_observation
             WHERE organization_id = $1 AND expires_at > NOW()
             ORDER BY company_domain, signal_key, observed_at DESC
         )
         SELECT company_domain
         FROM latest
         GROUP BY company_domain
         HAVING COUNT(*) FILTER (WHERE signal_key = ANY($2::text[]) AND (value->>'present')::boolean) = cardinality($2::text[])
            AND COUNT(*) FILTER (WHERE signal_key = ANY($3::text[]) AND NOT (value->>'present')::boolean) = cardinality($3::text[])
            AND COUNT(*) FILTER (WHERE EXISTS (
                    SELECT 1 FROM jsonb_to_recordset($4::jsonb) AS r(key text, min numeric, max numeric)
                    WHERE r.key = latest.signal_key
                      AND (value->>'number') IS NOT NULL
                      AND (r.min IS NULL OR (value->>'number')::numeric >= r.min)
                      AND (r.max IS NULL OR (value->>'number')::numeric <= r.max)
                )) = jsonb_array_length($4::jsonb)
         ORDER BY company_domain`,
        [organizationId, filter.mustHave, filter.mustNotHave, JSON.stringify(filter.ranges.map((r) => ({ key: r.key, min: r.min ?? null, max: r.max ?? null })))],
        organizationId
    );
    const all: string[] = res.rows.map((r: any) => r.company_domain);
    return { count: all.length, domains: all.slice(0, limit) };
}

/** Latest unexpired observations for these domains, limited to the signals the tenant confirmed. */
export async function signalsForDomains(organizationId: string, domains: string[]): Promise<Map<string, PullSignal[]>> {
    const out = new Map<string, PullSignal[]>();
    const unique = [...new Set(domains.filter(Boolean))];
    if (unique.length === 0) return out;

    const res = await queryWithOrg(
        `SELECT DISTINCT ON (o.company_domain, o.signal_key)
                o.company_domain, o.signal_key, o.value, o.evidence_url, o.observed_at
         FROM signal_observation o
         JOIN signal_confirmations c ON c.organization_id = o.organization_id AND c.signal_key = o.signal_key
         WHERE o.organization_id = $1 AND o.company_domain = ANY($2::text[]) AND o.expires_at > NOW()
         ORDER BY o.company_domain, o.signal_key, o.observed_at DESC`,
        [organizationId, unique],
        organizationId
    );
    for (const r of res.rows) {
        const list = out.get(r.company_domain) ?? [];
        list.push({ signal_key: r.signal_key, value: r.value, evidence_url: r.evidence_url ?? null, observed_at: new Date(r.observed_at).toISOString() });
        out.set(r.company_domain, list);
    }
    return out;
}

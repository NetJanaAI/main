import { queryAsSystem, queryWithOrg } from '../../lib/database';
import { collectMany } from './collector';
import { getConfirmed, saveObservations } from './store';

const DEFAULT_DOMAIN_LIMITS: Record<string, number> = { free: 25, paid: 500 };

/** Companies a tenant may track on its plan. WEBSITE_SIGNALS_DOMAIN_LIMITS overrides, e.g. {"free":10,"paid":1000}. */
export function domainLimitFor(plan: string | undefined, env: NodeJS.ProcessEnv = process.env): number {
    let limits = DEFAULT_DOMAIN_LIMITS;
    if (env.WEBSITE_SIGNALS_DOMAIN_LIMITS) {
        try {
            limits = { ...DEFAULT_DOMAIN_LIMITS, ...JSON.parse(env.WEBSITE_SIGNALS_DOMAIN_LIMITS) };
        } catch {
            limits = DEFAULT_DOMAIN_LIMITS;
        }
    }
    const fallback = DEFAULT_DOMAIN_LIMITS[plan ?? 'free'] ?? DEFAULT_DOMAIN_LIMITS.free;
    const limit = limits[plan ?? 'free'];
    return Number.isInteger(limit) && limit >= 0 ? limit : fallback;
}

/** Domains the tenant has collected, least recently observed first. */
export async function trackedDomains(organizationId: string): Promise<string[]> {
    const res = await queryWithOrg(
        `SELECT company_domain FROM signal_observation
         WHERE organization_id = $1
         GROUP BY company_domain
         ORDER BY MAX(observed_at) ASC`,
        [organizationId],
        organizationId
    );
    return res.rows.map((r: any) => r.company_domain);
}

/** Re-reads the tenant's tracked companies for its confirmed signals, up to its plan's limit. */
export async function refreshTenant(organizationId: string, plan: string | undefined): Promise<{ refreshed: number; failed: number }> {
    const confirmed = await getConfirmed(organizationId);
    if (confirmed.length === 0) return { refreshed: 0, failed: 0 };

    const domains = (await trackedDomains(organizationId)).slice(0, domainLimitFor(plan));
    const results = await collectMany(domains, { confirmed: new Set(confirmed) });

    let refreshed = 0;
    let failed = 0;
    for (const r of results) {
        if (!r.ok) {
            failed++;
            continue;
        }
        await saveObservations(organizationId, r.domain, r.observations);
        refreshed++;
    }
    return { refreshed, failed };
}

/** Daily job: refreshes every active tenant that has confirmed at least one signal. */
export async function refreshAllTenants(): Promise<void> {
    const tenants = await queryAsSystem(
        `SELECT DISTINCT t.id, t.plan FROM tenants t
         JOIN signal_confirmations c ON c.organization_id = t.id
         WHERE t.deactivated_at IS NULL`,
        []
    );
    for (const t of tenants.rows) {
        try {
            const { refreshed, failed } = await refreshTenant(t.id, t.plan);
            console.log(`[WebsiteSignals] Refreshed ${refreshed} companies for ${t.id} (${failed} failed).`);
        } catch (e: any) {
            console.error(`[WebsiteSignals] Refresh failed for ${t.id}:`, e.message);
        }
    }
}

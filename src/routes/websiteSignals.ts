import express from 'express';
import { z } from 'zod';
import { queryWithOrg } from '../lib/database';
import { isOrgAdmin } from '../lib/orgRole';
import { CATALOG, SIGNAL_KEYS } from '../signals/website/catalog';
import { collectMany, normalizeDomain } from '../signals/website/collector';
import { cohort, getConfirmed, observedCounts, saveObservations, setConfirmed } from '../signals/website/store';
import { domainLimitFor, trackedDomains } from '../signals/website/refresh';

const router = express.Router();

const KeyEnum = z.enum(SIGNAL_KEYS);

const ConfirmSchema = z.object({ signals: z.array(KeyEnum).max(SIGNAL_KEYS.length) });

const CollectSchema = z.object({
    targets: z.array(z.object({ domain: z.string().min(3).max(253), lead_id: z.string().uuid().optional() })).min(1).max(10),
    target_roles: z.array(z.string().min(1).max(60)).max(10).optional(),
});

const CohortSchema = z.object({
    must_have: z.array(KeyEnum).default([]),
    must_not_have: z.array(KeyEnum).default([]),
    ranges: z.array(z.object({ key: KeyEnum, min: z.number().optional(), max: z.number().optional() })).max(SIGNAL_KEYS.length).default([]),
});

/** Every signal, what it costs, whether the tenant confirmed it, and how many companies have it. */
router.get('/catalog', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const [confirmed, counts] = await Promise.all([getConfirmed(orgId), observedCounts(orgId)]);
    res.json({
        signals: CATALOG.map((s) => ({ ...s, confirmed: confirmed.includes(s.key), companies_observed: counts[s.key] ?? 0 })),
    });
});

/** Replaces the set of signals the tenant agrees to collect. Org admins only. */
router.put('/confirmed', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });
    if (!isOrgAdmin(req)) return res.status(403).json({ error: 'Forbidden: Organization admin role required.' });

    const parsed = ConfirmSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const signals = [...new Set(parsed.data.signals)];
    await setConfirmed(orgId, signals);
    res.json({ confirmed: signals });
});

/** Reads the companies' own public pages for the confirmed signals only. */
router.post('/collect', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const parsed = CollectSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const confirmed = await getConfirmed(orgId);
    if (confirmed.length === 0) {
        return res.status(409).json({ error: 'Confirm at least one signal before collecting.' });
    }

    const targets: { domain: string; leadId?: string }[] = [];
    const rejected: { input: string; reason: string }[] = [];
    for (const t of parsed.data.targets) {
        const domain = normalizeDomain(t.domain);
        if (domain) targets.push({ domain, leadId: t.lead_id });
        else rejected.push({ input: t.domain, reason: 'Not a valid domain name' });
    }

    const tracked = new Set(await trackedDomains(orgId));
    const limit = domainLimitFor(req.tenantTier);
    const added = new Set(targets.map((t) => t.domain).filter((d) => !tracked.has(d)));
    if (tracked.size + added.size > limit) {
        return res.status(409).json({ error: `Your plan tracks up to ${limit} companies; ${tracked.size} are tracked already.` });
    }

    const results = await collectMany(targets.map((t) => t.domain), {
        confirmed: new Set(confirmed),
        targetRoles: parsed.data.target_roles,
    });

    const summary: { domain: string; ok: boolean; signals?: number; reason?: string }[] = [];
    for (let i = 0; i < results.length; i++) {
        const r = results[i];
        if (!r.ok) {
            summary.push({ domain: r.domain, ok: false, reason: r.reason });
            continue;
        }
        await saveObservations(orgId, r.domain, r.observations);
        const leadId = targets[i].leadId;
        if (leadId) {
            await queryWithOrg('UPDATE lead_cards SET company_domain = $1 WHERE lead_id = $2 AND org_id = $3', [r.domain, leadId, orgId], orgId);
        }
        summary.push({ domain: r.domain, ok: true, signals: r.observations.length });
    }
    res.json({ results: summary, rejected });
});

/** Live count (and the first 100 domains) for a combination of signals. */
router.post('/cohort', async (req: any, res) => {
    const orgId = req.organizationId;
    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    const parsed = CohortSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: 'Invalid payload' });

    const { must_have, must_not_have, ranges } = parsed.data;
    const confirmed = await getConfirmed(orgId);
    const used = [...must_have, ...must_not_have, ...ranges.map((r) => r.key)];
    const unconfirmed = used.filter((k) => !confirmed.includes(k));
    if (unconfirmed.length > 0) {
        return res.status(409).json({ error: `Signals not confirmed: ${[...new Set(unconfirmed)].join(', ')}` });
    }

    res.json(await cohort(orgId, { mustHave: must_have, mustNotHave: must_not_have, ranges }));
});

export default router;

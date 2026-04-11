import crypto from 'crypto';
import axios from 'axios';
import { SovereignFirewall } from './lib/ai/SovereignFirewall'; // Air-gapped logic
import { ScrapeResultSchema, type ScrapeResult } from './lib/schemas';
import { query } from './lib/database';
import { generateCapsule, signCapsule } from './lib/dataCapsule';

const firewall = new SovereignFirewall(process.env.REGION_ID || 'UAE_DUBAI_01');
import { IS_COVOSPAN } from './config/mode';

const HMAC_SECRET = process.env.HMAC_SECRET;
const BRAIN_WEBHOOK_URL = process.env.BRAIN_WEBHOOK_URL || 'http://localhost:4000/api/webhooks/scraper-ingest';
const REGION_ID = process.env.REGION_ID || 'UAE_DUBAI_01';
const CONVOSPAN_EDGE_WEBHOOK_URL = process.env.CONVOSPAN_EDGE_WEBHOOK_URL;

if (!HMAC_SECRET) {
    console.warn('[Dispatcher] WARNING: HMAC_SECRET is not defined. Secure dispatch will fail in production.');
}

export interface ViolationReport {
    domain: string;
    reason: string;
    type: 'ROBOTS_TXT' | 'PDPL_VIOLATION' | 'CLOUDFLARE_BOT_MODE';
}

export async function sendResults(data: any, organizationId?: string): Promise<void> {
    try {
        console.log(`[Dispatcher] Initiating Dispatch for ${data.domain} (Org: ${organizationId || 'Default'}, Mode: ${IS_COVOSPAN ? 'COVOSPAN' : 'STANDALONE'})...`);

        // 1. Reversible Tokenization (Local Identity Vault) - ONLY in COVOSPAN mode
        let maskedData = data;
        if (IS_COVOSPAN) {
            const firewall = new SovereignFirewall(process.env.REGION_ID || 'UAE_DUBAI_01', organizationId);
            maskedData = JSON.parse(await firewall.maskData(JSON.stringify(data)));
        }

        // 2. Identity Handshake (HMAC Signature)
        const fullPayload = { event: 'scrape_complete', payload: maskedData };
        const secret = HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod';
        const signature = crypto.createHmac('sha256', secret)
            .update(JSON.stringify(fullPayload))
            .digest('hex');

        // 3. Secure Dispatch
        await axios.post(BRAIN_WEBHOOK_URL, fullPayload, {
            headers: {
                'X-Region-ID': REGION_ID,
                'X-Compliance-Signature': signature
            }
        });

        // 4. Persistence to Vault
        try {
            await query(`
                INSERT INTO scrape_results (
                    job_id, domain, friction_score, signals, geo_country,
                    estimated_roi, compliance_verified, critic_analysis,
                    screenshot_path, spider_stats, organization_id, timestamp
                ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
            `, [
                data.jobId || crypto.randomUUID(),
                data.domain,
                data.frictionScore,
                JSON.stringify(data.signals || []),
                data.geoCountry,
                data.estimatedRoi,
                data.complianceVerified,
                JSON.stringify(data.criticAnalysis || {}),
                data.screenshotPath || null,
                data.spiderStats ? JSON.stringify(data.spiderStats) : null,
                organizationId || null,
                data.timestamp || new Date().toISOString()
            ]);
            console.log(`[Dispatcher] Persisted result to Postgres PII Vault.`);
        } catch (dbError: any) {
            console.warn(`[Dispatcher] Failed to persist to Postgres:`, dbError.message);
        }

        // 5. Convospan Edge Data Capsule Push + Logging
        const capsule = generateCapsule(data);
        capsule.signature = signCapsule(capsule);
        const jobIdForLog = data.jobId || crypto.randomUUID();

        // Always log the capsule attempt
        let capsuleLogId: string | undefined;
        try {
            const logResult = await query(`
                INSERT INTO capsule_log (job_id, domain, capsule, status, organization_id)
                VALUES ($1, $2, $3, $4, $5) RETURNING id
            `, [jobIdForLog, data.domain, JSON.stringify(capsule), 'pending', organizationId || null]);
            capsuleLogId = logResult.rows[0]?.id;
        } catch (logErr: any) {
            console.warn(`[Dispatcher] Could not log capsule to DB:`, logErr.message);
        }

        if (CONVOSPAN_EDGE_WEBHOOK_URL) {
            try {
                console.log(`[Dispatcher] Generating Convospan Edge Data Capsule...`);
                await axios.post(CONVOSPAN_EDGE_WEBHOOK_URL, capsule, {
                    headers: {
                        'Content-Type': 'application/json',
                        'X-Convospan-Signature': capsule.signature
                    }
                });
                console.log(`[Dispatcher] Successfully pushed Data Capsule to Convospan Edge.`);
                // Update capsule log status
                if (capsuleLogId) {
                    await query(`UPDATE capsule_log SET status = 'delivered', delivered_at = NOW() WHERE id = $1`, [capsuleLogId]);
                }
                // Upsert campaign as CAPSULE_SENT
                await query(`
                    INSERT INTO campaigns (domain, state, capsule_id, organization_id) VALUES ($1, 'CAPSULE_SENT', $2, $3)
                    ON CONFLICT (domain) DO UPDATE SET state = 'CAPSULE_SENT', capsule_id = $2, organization_id = $3, updated_at = NOW()
                `, [data.domain, capsuleLogId || null, organizationId || null]);
            } catch (edgeError: any) {
                console.warn(`[Dispatcher] Failed to push to Convospan Edge:`, edgeError.message);
                if (capsuleLogId) {
                    await query(`UPDATE capsule_log SET status = 'failed' WHERE id = $1`, [capsuleLogId]);
                }
            }
        } else {
            // No webhook — still upsert campaign as DISCOVERED
            try {
                await query(`
                    INSERT INTO campaigns (domain, state, organization_id) VALUES ($1, 'DISCOVERED', $2)
                    ON CONFLICT (domain) DO NOTHING
                `, [data.domain, organizationId || null]);
                if (capsuleLogId) {
                    await query(`UPDATE capsule_log SET status = 'ready' WHERE id = $1`, [capsuleLogId]);
                }
            } catch (_) {}
        }

        console.log(`[Dispatcher] Secure Dispatch successful.`);
    } catch (error: any) {
        console.error(`[Dispatcher] Dispatch Failed:`, error.message);
        throw new Error(`Critical Dispatch Failure: ${error.message}`);
    }
}

export async function reportViolation(data: ViolationReport): Promise<void> {
    // Basic dispatcher for violations (implementation aligned with secure sendResults logic)
    try {
        const secret = HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod';
        const signature = crypto.createHmac('sha256', secret)
            .update(JSON.stringify({ event: 'compliance_violation', payload: data }))
            .digest('hex');

        await axios.post(BRAIN_WEBHOOK_URL, {
            event: 'compliance_violation',
            payload: data
        }, {
            headers: {
                'X-Region-ID': REGION_ID,
                'X-Compliance-Signature': signature
            }
        });
    } catch (e) {
        console.error('[Dispatcher] Failed to report violation.');
    }
}

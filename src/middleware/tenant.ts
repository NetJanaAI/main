import { Request, Response, NextFunction } from 'express';
import { query } from '../lib/database';
import crypto from 'crypto';
import { createClerkClient, verifyToken } from '@clerk/backend';
import { getHmacSecret, getApiKeySecret } from '../lib/secrets';
import { AuditTrail } from '../core/compliance/AuditTrail';

const clerkClient = createClerkClient({ secretKey: process.env.CLERK_SECRET_KEY });

export interface TenantRequest extends Request {
    organizationId?: string;
    auth?: any;
}

/**
 * Enhanced middleware to support Clerk OAuth + Legacy API Keys
 */
export const tenantContext = async (req: TenantRequest, res: Response, next: NextFunction) => {
    const apiKey = req.headers['x-api-key'] as string;
    const authHeader = req.headers.authorization;
    const orgIdHeader = req.headers['x-organization-id'] as string;
    const publicApiPaths = new Set([
        '/api/leads/stats'
    ]);

    if (req.path.startsWith('/api/ingest')) {
        return next();
    }

    // UI-01: /api/leads/stats is now auth-required. Removing from publicApiPaths
    // prevents unauthenticated callers from reading aggregate business intelligence.
    const hasAuthMaterial = Boolean(apiKey || authHeader?.startsWith('Bearer ') || orgIdHeader);
    if (!hasAuthMaterial && !req.path.startsWith('/api')) {
        return next();
    }

    // 1. Clerk OAuth Path
    if (authHeader?.startsWith('Bearer ')) {
        const token = authHeader.split(' ')[1];
        try {
            const verified = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
            const clerkUserId = verified.sub;
            const clerkOrgId = (verified as any).org_id; // Check if org context exists

            // Lookup tenant by orgId first (if present), then by userId
            const sql = clerkOrgId 
                ? 'SELECT id FROM tenants WHERE clerk_org_id = $1'
                : 'SELECT id FROM tenants WHERE clerk_user_id = $1';
            
            const result = await query(sql, [clerkOrgId || clerkUserId]);
            
            if (result.rows.length > 0) {
                req.organizationId = result.rows[0].id;
                req.auth = verified;
                return next();
            }
        } catch (e) {
            console.debug('[TenantContext] Clerk verify failed:', (e as Error).message);
            // Fall through to API key check
        }
    }

    // 2. API Key Path
    if (apiKey) {
        const apiKeySecret = getApiKeySecret();
        const apiKeyHash = crypto.createHmac('sha256', apiKeySecret).update(apiKey).digest('hex');
        
        try {
            let result = await query('SELECT id FROM tenants WHERE api_key_hash = $1', [apiKeyHash]);
            if (result.rows.length === 0) {
                // Dynamic hash migration fallback
                const oldSecret = process.env.OLD_HMAC_SECRET || process.env.HMAC_SECRET;
                if (oldSecret) {
                    const oldHash = crypto.createHmac('sha256', oldSecret).update(apiKey).digest('hex');
                    result = await query('SELECT id FROM tenants WHERE api_key_hash = $1', [oldHash]);
                    if (result.rows.length > 0) {
                        const tenantId = result.rows[0].id;
                        console.log(`[TenantContext] Migrating api_key_hash dynamically for tenant ${tenantId} to new API_KEY_SECRET.`);
                        await query('UPDATE tenants SET api_key_hash = $1 WHERE id = $2', [apiKeyHash, tenantId]);
                        // Audit Log the hash migration
                        await AuditTrail.log({
                            actorId: 'system_migration',
                            organizationId: tenantId,
                            action: 'API_KEY_HASH_MIGRATED',
                            resource: `tenant:${tenantId}`,
                            metadata: { reason: 'api_key_secret_separation_migration' }
                        });
                    }
                }
            }

            if (result.rows.length > 0) {
                req.organizationId = result.rows[0].id;
                return next();
            }
        } catch (e) {
            console.error('[TenantContext] Auth DB failure:', e);
        }
    }
    
    // SEC-04: x-organization-id bypass removed.
    // Previously any caller in non-production could pass x-organization-id to spoof tenants (IDOR risk).
    // All authentication must now go through Clerk JWT or API key hash lookup.

    // 3. Local Dev Fallback
    // Allows the app to be exercised end-to-end with Docker Postgres/Redis before
    // real Clerk/API-key secrets are provisioned. Never active in production.
    if (!req.organizationId && process.env.NODE_ENV !== 'production') {
        try {
            const result = await query("SELECT id FROM tenants WHERE name = 'Default Organization' LIMIT 1");
            if (result.rows.length > 0) {
                req.organizationId = result.rows[0].id;
                return next();
            }
        } catch (e) {
            console.error('[TenantContext] Dev fallback DB failure:', e);
        }
    }
    
    if (!req.organizationId && req.path.startsWith('/api') && !req.path.includes('/webhooks')) {
        return res.status(401).json({ error: 'Unauthorized: Valid Session or API Key Required' });
    }

    next();
};

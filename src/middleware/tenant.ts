import { Request, Response, NextFunction } from 'express';
import { query } from '../lib/database';
import crypto from 'crypto';
import { createClerkClient, verifyToken } from '@clerk/backend';

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
        const ADMIN_SECRET = process.env.HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod';
        const apiKeyHash = crypto.createHmac('sha256', ADMIN_SECRET).update(apiKey).digest('hex');
        
        try {
            const result = await query('SELECT id FROM tenants WHERE api_key_hash = $1', [apiKeyHash]);
            if (result.rows.length > 0) {
                req.organizationId = result.rows[0].id;
                return next();
            }
        } catch (e) {
            console.error('[TenantContext] Auth DB failure:', e);
        }
    }
    
    // 3. Dev Fallback
    if (orgIdHeader && process.env.NODE_ENV !== 'production') {
        req.organizationId = orgIdHeader;
    }
    
    if (!req.organizationId && req.path.startsWith('/api') && !req.path.includes('/webhooks')) {
        return res.status(401).json({ error: 'Unauthorized: Valid Session or API Key Required' });
    }

    next();
};

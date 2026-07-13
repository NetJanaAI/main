import { createClerkClient, verifyToken } from '@clerk/backend';
import { db } from '../lib/database';
import crypto from 'crypto';
import { getApiKeySecret } from '../lib/secrets';

const DEV_DEFAULT_ORG = 'demo_standalone_org';

export async function socketAuthMiddleware(socket: any, next: (err?: Error) => void) {
    const token = socket.handshake.auth?.token || socket.handshake.headers?.authorization?.split(' ')[1];
    const apiKey = socket.handshake.auth?.apiKey || socket.handshake.headers?.['x-api-key'];

    // 1. Verify Clerk JWT Token
    if (token) {
        try {
            const verified = await verifyToken(token, { secretKey: process.env.CLERK_SECRET_KEY });
            const clerkUserId = verified.sub;
            const clerkOrgId = (verified as any).org_id;

            const sql = clerkOrgId 
                ? 'SELECT id FROM tenants WHERE clerk_org_id = $1'
                : 'SELECT id FROM tenants WHERE clerk_user_id = $1';
            
            const result = await db.query(sql, [clerkOrgId || clerkUserId]);
            if (result.rows.length > 0) {
                socket.organizationId = result.rows[0].id;
                socket.user = verified;
                return next();
            }
        } catch (e: any) {
            console.debug('[SocketAuth] Clerk token verification failed:', e.message);
        }
    }

    // 2. Verify API Key
    if (apiKey) {
        const apiKeySecret = getApiKeySecret();
        const apiKeyHash = crypto.createHmac('sha256', apiKeySecret).update(apiKey).digest('hex');
        try {
            const result = await db.query('SELECT id FROM tenants WHERE api_key_hash = $1', [apiKeyHash]);
            if (result.rows.length > 0) {
                socket.organizationId = result.rows[0].id;
                return next();
            }
        } catch (e: any) {
            console.error('[SocketAuth] API key database lookup failed:', e.message);
        }
    }

    // 3. Dev / Staging Fallback
    if (process.env.NODE_ENV !== 'production') {
        const clientRequestedOrg = socket.handshake.query?.organizationId;
        socket.organizationId = clientRequestedOrg || DEV_DEFAULT_ORG;
        console.warn(`[SocketAuth] Local/Dev fallback active. Assigned socket ${socket.id} to org: ${socket.organizationId}`);
        return next();
    }

    // 4. Deny Access in Production if no credentials verify
    console.warn(`[SocketAuth] Denied connection from ${socket.id} - missing or invalid credentials`);
    next(new Error('Authentication required: Valid Session Token or API Key expected.'));
}

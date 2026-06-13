/**
 * migrate-api-keys.ts
 *
 * One-time offline migration utility to rehash tenant API keys.
 * Expects PLAINTEXT_API_KEYS in env as comma-separated values,
 * or a file path passed as a command line argument containing one key per line.
 *
 * Usage:
 *   npx tsx scripts/migrate-api-keys.ts [path/to/keys.txt]
 */

import 'dotenv/config';
import { Pool } from 'pg';
import crypto from 'crypto';
import * as fs from 'fs';

async function main() {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
        console.error('[Migration] DATABASE_URL is required.');
        process.exit(1);
    }

    const apiKeySecret = process.env.API_KEY_SECRET;
    if (!apiKeySecret) {
        console.error('[Migration] API_KEY_SECRET is required.');
        process.exit(1);
    }

    const oldSecret = process.env.OLD_HMAC_SECRET || process.env.HMAC_SECRET;
    if (!oldSecret) {
        console.error('[Migration] OLD_HMAC_SECRET or HMAC_SECRET is required to calculate the old hashes.');
        process.exit(1);
    }

    // Resolve plaintext API keys
    let plaintextKeys: string[] = [];

    // Check command line arguments first
    const fileArg = process.argv[2];
    if (fileArg) {
        if (!fs.existsSync(fileArg)) {
            console.error(`[Migration] File not found: ${fileArg}`);
            process.exit(1);
        }
        plaintextKeys = fs.readFileSync(fileArg, 'utf-8')
            .split(/\r?\n/)
            .map(line => line.trim())
            .filter(line => line.length > 0);
        console.log(`[Migration] Loaded ${plaintextKeys.length} keys from file: ${fileArg}`);
    } else if (process.env.PLAINTEXT_API_KEYS) {
        plaintextKeys = process.env.PLAINTEXT_API_KEYS.split(',')
            .map(k => k.trim())
            .filter(k => k.length > 0);
        console.log(`[Migration] Loaded ${plaintextKeys.length} keys from PLAINTEXT_API_KEYS env var.`);
    }

    if (plaintextKeys.length === 0) {
        console.error('[Migration] No plaintext API keys provided. Specify a file path argument or set PLAINTEXT_API_KEYS in env.');
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production'
            ? {
                rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false',
                ca: process.env.PG_SSL_CA_CERT
                    ? process.env.PG_SSL_CA_CERT
                    : (process.env.PG_SSL_CA_PATH
                        ? fs.readFileSync(process.env.PG_SSL_CA_PATH, 'utf8')
                        : undefined)
              }
            : false,
    });

    console.log('[Migration] Connecting to database...');
    const client = await pool.connect();

    try {
        console.log('[Migration] Beginning transaction...');
        await client.query('BEGIN');

        let migratedCount = 0;
        let skippedCount = 0;

        for (const apiKey of plaintextKeys) {
            const oldHash = crypto.createHmac('sha256', oldSecret).update(apiKey).digest('hex');
            const newHash = crypto.createHmac('sha256', apiKeySecret).update(apiKey).digest('hex');

            // Find tenant by old hash
            const lookupRes = await client.query(
                'SELECT id, name FROM tenants WHERE api_key_hash = $1',
                [oldHash]
            );

            if (lookupRes.rows.length > 0) {
                const tenant = lookupRes.rows[0];
                console.log(`[Migration] Found tenant "${tenant.name}" (ID: ${tenant.id}) matching old hash. Updating to new hash...`);
                
                await client.query(
                    'UPDATE tenants SET api_key_hash = $1 WHERE id = $2',
                    [newHash, tenant.id]
                );

                // Insert into audit logs
                const auditTimestamp = new Date().toISOString();
                const auditEvent = {
                    actorId: 'system_migration',
                    organizationId: tenant.id,
                    action: 'API_KEY_HASH_MIGRATED',
                    resource: `tenant:${tenant.id}`,
                    metadata: { reason: 'api_key_secret_separation_migration_offline' }
                };
                const auditPayload = JSON.stringify(auditEvent);
                const auditSignature = crypto
                    .createHmac('sha256', process.env.HMAC_SECRET || 'dev-safety-fallback-do-not-use-in-prod')
                    .update(`${auditTimestamp}|${auditPayload}`)
                    .digest('hex');

                await client.query(
                    `INSERT INTO audit_logs (timestamp, actor_id, organization_id, action, resource, metadata, signature)
                     VALUES ($1, $2, $3, $4, $5, $6, $7)`,
                    [auditTimestamp, auditEvent.actorId, auditEvent.organizationId, auditEvent.action, auditEvent.resource, auditPayload, auditSignature]
                );

                migratedCount++;
            } else {
                // Check if already migrated
                const checkNewRes = await client.query(
                    'SELECT id, name FROM tenants WHERE api_key_hash = $1',
                    [newHash]
                );
                if (checkNewRes.rows.length > 0) {
                    console.log(`[Migration] Key already migrated to new hash for tenant "${checkNewRes.rows[0].name}". Skipping.`);
                    skippedCount++;
                } else {
                    console.warn(`[Migration] Key did not match any tenant's active hash. Skipping.`);
                    skippedCount++;
                }
            }
        }

        console.log('[Migration] Committing transaction...');
        await client.query('COMMIT');
        console.log(`[Migration] API key migration completed successfully. Migrated: ${migratedCount}, Skipped/Unmatched: ${skippedCount}.`);
    } catch (e: any) {
        console.error('[Migration] Error encountered. Rolling back transaction...', e.message);
        await client.query('ROLLBACK');
        process.exit(1);
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((e) => {
    console.error('[Migration] Fatal error:', e.message);
    process.exit(1);
});

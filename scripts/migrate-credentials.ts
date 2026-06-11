/**
 * migrate-credentials.ts
 *
 * P0-B One-time migration: encrypts all plaintext values in data_source_credentials
 * using the AES-256-GCM credentialVault.
 *
 * Usage:
 *   Set CREDENTIAL_ENCRYPTION_KEY and DATABASE_URL in your environment, then run:
 *   npx tsx scripts/migrate-credentials.ts
 *
 * Safe to run multiple times — already-encrypted rows are detected by
 * `isEncrypted()` and skipped.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { encryptCredential, isEncrypted } from '../src/lib/credentialVault';

async function main() {
    const DATABASE_URL = process.env.DATABASE_URL;
    if (!DATABASE_URL) {
        console.error('[Migration] DATABASE_URL is required.');
        process.exit(1);
    }

    if (!process.env.CREDENTIAL_ENCRYPTION_KEY) {
        console.error('[Migration] CREDENTIAL_ENCRYPTION_KEY is required. Generate with:');
        console.error("  node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\"");
        process.exit(1);
    }

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
    });

    console.log('[Migration] Connecting to database...');
    const client = await pool.connect();

    try {
        const { rows } = await client.query(
            'SELECT id, credential_value FROM data_source_credentials'
        );

        console.log(`[Migration] Found ${rows.length} credential rows.`);

        let migrated = 0;
        let skipped = 0;
        let errors = 0;

        for (const row of rows) {
            if (isEncrypted(row.credential_value)) {
                skipped++;
                continue;
            }

            try {
                const encrypted = encryptCredential(row.credential_value);
                await client.query(
                    'UPDATE data_source_credentials SET credential_value = $1 WHERE id = $2',
                    [encrypted, row.id]
                );
                migrated++;
            } catch (e: any) {
                console.error(`[Migration] Failed to encrypt row ${row.id}: ${e.message}`);
                errors++;
            }
        }

        console.log(`[Migration] Done. Migrated: ${migrated}, Skipped (already encrypted): ${skipped}, Errors: ${errors}`);

        if (errors > 0) {
            console.error('[Migration] Some rows failed to encrypt. Check the errors above.');
            process.exit(1);
        }
    } finally {
        client.release();
        await pool.end();
    }
}

main().catch((e) => {
    console.error('[Migration] Fatal error:', e.message);
    process.exit(1);
});

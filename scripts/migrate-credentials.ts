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
import crypto from 'crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;
const TAG_LENGTH = 16;

function decryptWithOldKey(stored: string, oldKeyHex: string): string {
    const parts = stored.split(':');
    if (parts.length !== 3) {
        return stored; // Plaintext legacy fallback
    }
    const [ivHex, authTagHex, encryptedHex] = parts;
    const key = Buffer.from(oldKeyHex, 'hex');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');

    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv, { authTagLength: TAG_LENGTH });
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted).toString('utf8') + decipher.final('utf8');
}

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

    const oldKeyHex = process.env.OLD_CREDENTIAL_ENCRYPTION_KEY;
    if (oldKeyHex) {
        console.log('[Migration] Key rotation mode active. Decrypting with OLD_CREDENTIAL_ENCRYPTION_KEY...');
        if (oldKeyHex.length !== 64) {
            console.error('[Migration] OLD_CREDENTIAL_ENCRYPTION_KEY must be 32 bytes (64 hex characters).');
            process.exit(1);
        }
    }

    const pool = new Pool({
        connectionString: DATABASE_URL,
        ssl: process.env.NODE_ENV === 'production'
            ? {
                rejectUnauthorized: process.env.PG_SSL_REJECT_UNAUTHORIZED !== 'false',
                ca: process.env.PG_SSL_CA_CERT
                    ? process.env.PG_SSL_CA_CERT
                    : (process.env.PG_SSL_CA_PATH
                        ? require('fs').readFileSync(process.env.PG_SSL_CA_PATH, 'utf8')
                        : undefined)
              }
            : false,
    });

    console.log('[Migration] Connecting to database...');
    const client = await pool.connect();

    try {
        const { rows } = await client.query(
            'SELECT id, provider, credential_name, credential_value FROM data_source_credentials'
        );

        console.log(`[Migration] Found ${rows.length} credential rows.`);

        let migrated = 0;
        let skipped = 0;
        let errors = 0;

        for (const row of rows) {
            const isEnc = isEncrypted(row.credential_value);

            if (isEnc && !oldKeyHex) {
                skipped++;
                continue;
            }

            try {
                let plaintext: string;
                if (!isEnc) {
                    plaintext = row.credential_value;
                    console.log(`[Migration] Row ${row.id} (${row.provider}:${row.credential_name}) is plaintext. Encrypting...`);
                } else {
                    plaintext = decryptWithOldKey(row.credential_value, oldKeyHex!);
                    console.log(`[Migration] Row ${row.id} (${row.provider}:${row.credential_name}) is encrypted. Decrypting with old key and re-encrypting...`);
                }

                const encrypted = encryptCredential(plaintext);
                await client.query(
                    'UPDATE data_source_credentials SET credential_value = $1, updated_at = NOW() WHERE id = $2',
                    [encrypted, row.id]
                );
                migrated++;
            } catch (e: any) {
                console.error(`[Migration] Failed to migrate/encrypt row ${row.id}: ${e.message}`);
                errors++;
            }
        }

        console.log(`[Migration] Done. Migrated/Re-encrypted: ${migrated}, Skipped: ${skipped}, Errors: ${errors}`);

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

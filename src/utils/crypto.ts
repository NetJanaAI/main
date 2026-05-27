import crypto from 'crypto';
import { getEncryptionKey, isProduction } from '../lib/secrets';

const HMAC_SECRET = process.env.HMAC_SECRET;

if (isProduction() && !HMAC_SECRET) {
    console.error('[Crypto] FATAL: HMAC_SECRET is missing or using dev-placeholder in production.');
    process.exit(1);
}

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = getEncryptionKey();

export function encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let encrypted = cipher.update(text);
    encrypted = Buffer.concat([encrypted, cipher.final()]);
    return iv.toString('hex') + ':' + encrypted.toString('hex');
}

export function decrypt(text: string): string {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift()!, 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, Buffer.from(ENCRYPTION_KEY), iv);
    let decrypted = decipher.update(encryptedText);
    decrypted = Buffer.concat([decrypted, decipher.final()]);
    return decrypted.toString();
}

import crypto from 'crypto';

const isDev = process.env.NODE_ENV !== 'production';
const HMAC_SECRET = process.env.HMAC_SECRET;

if (!isDev && (!HMAC_SECRET || HMAC_SECRET === 'dev-placeholder-long-random-string-32-chars')) {
    console.error('[Crypto] FATAL: HMAC_SECRET is missing or using dev-placeholder in production.');
    process.exit(1);
}

const ALGORITHM = 'aes-256-cbc';
const ENCRYPTION_KEY = (HMAC_SECRET || 'dev-placeholder-long-random-string-32-chars').slice(0, 32).padEnd(32, '0');

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

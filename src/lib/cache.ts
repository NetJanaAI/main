import { Redis } from 'ioredis';

const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';

// Explicitly use TLS if connecting to a cloud rediss:// URL
const tlsConfig = redisUrl.startsWith('rediss://') ? { rejectUnauthorized: false } : undefined;

export const cache = new Redis(redisUrl, { tls: tlsConfig });


import 'dotenv/config'; // Load .env file immediately
import { SecureLogger } from './utils/logger';
import { initDb } from './lib/database';

// Initialize Secure Logger immediately
SecureLogger.init();

// Environment Validation: Fail-fast if critical keys are missing
function validateEnv() {
    const missing: string[] = [];
    if (!process.env.GOOGLE_API_KEY) missing.push('GOOGLE_API_KEY');
    if (!process.env.DATABASE_URL) missing.push('DATABASE_URL');
    if (!process.env.CLERK_SECRET_KEY) missing.push('CLERK_SECRET_KEY');
    if (!process.env.UPSTASH_REDIS_REST_URL) missing.push('UPSTASH_REDIS_REST_URL');
    if (!process.env.HMAC_SECRET) missing.push('HMAC_SECRET');
    if (!process.env.ALLOWED_INGEST_IPS) missing.push('ALLOWED_INGEST_IPS');
    if (missing.length > 0) {
        const isStandalone = process.env.NETJANA_MODE === 'standalone';
        const isDev = process.env.NODE_ENV !== 'production'; // More inclusive check
        if (isStandalone || isDev) {
            console.warn(`[Warning] Missing environment variables: ${missing.join(', ')}`);
            console.warn(`[Warning] System starting in DEGRADED MODE for local exploration.`);
        } else {
            console.error(`[Fatal] Missing critical environment variables: ${missing.join(', ')}`);
            process.exit(1);
        }
    }
    console.log('[Startup] Environment validated successfully.');
}
validateEnv();

const dbReady = initDb().catch(e => {
    console.error("Database initialization failed", e);
    if (process.env.NODE_ENV === 'production') {
        process.exit(1);
    }
});

import Sentry from "@sentry/node";
import { nodeProfilingIntegration } from "@sentry/profiling-node";
import express from 'express';
import 'express-async-errors'; // Centralized async error handling
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { tenantRateLimiter, scrapeLimiter } from './middleware/rateLimit';
import path from 'path';

import scrapeRoutes from './routes/scrape';
import resultsRoutes from './routes/results';
import capsulesRoutes from './routes/capsules';
import campaignsRoutes from './routes/campaigns';
import schedulesRoutes from './routes/schedules';
import knowledgeRoutes from './routes/knowledge';
import vaultRoutes from './routes/vault';
import adminRoutes from './routes/admin';
import ingestRoutes from './routes/ingest';
import leadsRoutes from './routes/leads';
import profileRoutes from './routes/profile';
import watchProfilesRoutes from './routes/watch-profiles';
import apiManagerRoutes from './routes/api-manager';
import reportsRoutes from './routes/reports';
import outreachRoutes from './routes/outreach';
import shareRoutes from './routes/share';
import covospanRoutes from './routes/covospan';
import telemetryRoutes from './routes/telemetry';
import sourceRoutes from './routes/sources';
import webhookRoutes from './routes/webhooks';
import usageRoutes from './routes/usage';
import netjanaIntelRoutes from './routes/netjana-intel';
import analyticsRoutes from './routes/analytics';
import dlqRoutes from './routes/dlq';

import { bootstrapSchedules } from './lib/scheduler';
import { setupRecalibrationCron } from './lib/recalibration';
import { tenantContext } from './middleware/tenant';
import { HACanary } from './lib/canary';
import { errorHandler } from './middleware/error-handler';
import { register, getSystemHealth } from './lib/telemetry';
import { setupScrapeWorker } from './workers/scrapeWorker';
import { setupDlqWorker } from './workers/dlqWorker';
import { startOutreachWorker } from './workers/outreach_worker';
import { startInfluenceWorker } from './workers/influenceMapWorker';
import { startDecayRescoreWorker } from './workers/decayRescoreWorker';
import { setupRouterWorker } from './core/router';
import { setupGeminiWorkers } from './core/gemini-chain';

const app = express();
const httpServer = createServer(app);

// Sentry Initialization
if (process.env.SENTRY_DSN && !process.env.SENTRY_DSN.includes('placeholder')) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    integrations: [
      nodeProfilingIntegration(),
    ],
    tracesSampleRate: 1.0,
    profilesSampleRate: 1.0,
  });
}

// Use raw body for Clerk webhooks before global json parsing
app.use('/api/webhooks', express.raw({ type: 'application/json' }), (req: any, res, next) => {
    req.rawBody = req.body;
    next();
}, webhookRoutes);

const allowedOrigins = process.env.ALLOWED_ORIGINS
    ? process.env.ALLOWED_ORIGINS.split(',').map(o => o.trim())
    : "*";

const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
        credentials: true
    }
});

// globalLimiter has been replaced by tenantRateLimiter below

import Redis from 'ioredis';
async function waitForRedis(maxMs = 30_000): Promise<void> {
    const host = process.env.REDIS_HOST || 'localhost';
    const port = parseInt(process.env.REDIS_PORT || '6379');
    const client = new Redis({ host, port, lazyConnect: true });
    const start = Date.now();
    while (Date.now() - start < maxMs) {
        try { await client.ping(); await client.quit(); return; }
        catch { await new Promise(r => setTimeout(r, 1000)); }
    }
    throw new Error('[Startup] Redis not available after 30s. Aborting.');
}

async function startWorkers(ioInstance: Server) {
    try {
        await waitForRedis();

        setupScrapeWorker(ioInstance);
        setupDlqWorker();
        await startOutreachWorker(ioInstance);
        await startInfluenceWorker(ioInstance);
        await startDecayRescoreWorker(ioInstance);
        setupRouterWorker();
        setupGeminiWorkers(ioInstance);
        setupRecalibrationCron(ioInstance);
        console.log('[Startup] Workers initialized successfully.');
    } catch (err) {
        console.error('[Startup] Failed to start workers:', err);
    }
}

startWorkers(io);

app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            ...helmet.contentSecurityPolicy.getDefaultDirectives(),
            "script-src": ["'self'", "'unsafe-inline'", "https://clerk.netjana.ai", "https://*.clerk.accounts.dev"],
            "connect-src": ["'self'", "https://clerk.netjana.ai", "https://*.clerk.accounts.dev", "wss://*.clerk.accounts.dev", "http://localhost:3001", "ws://localhost:3001"],
            "img-src": ["'self'", "data:", "https://img.clerk.com"],
            "worker-src": ["'self'", "blob:"]
        },
    },
}));

app.use(cors({
    origin: (origin, callback) => {
        // In production, only allow specific origins
        if (process.env.NODE_ENV === 'production') {
            const allowed = process.env.ALLOWED_ORIGINS ? process.env.ALLOWED_ORIGINS.split(',') : [];
            if (!origin || allowed.indexOf(origin) !== -1) {
                callback(null, true);
            } else {
                callback(new Error('Not allowed by CORS'));
            }
        } else {
            callback(null, true); // Allow all in dev
        }
    },
    credentials: true
}));
app.use(express.json({
    verify: (req: any, res, buf) => {
        req.rawBody = buf;
    }
}));
app.use('/api', tenantRateLimiter);

// --- Observability Endpoints ---
app.get('/metrics', async (req, res) => {
    try {
        res.set('Content-Type', register.contentType);
        res.end(await register.metrics());
    } catch (e) {
        res.status(500).end(e);
    }
});

app.get('/health', async (req, res) => {
    const health = await getSystemHealth();
    res.status(health.status === 'UP' ? 200 : 503).json(health);
});

// Pass io instance to request object middleware
app.use(tenantContext);
app.use((req, res, next) => {
    (req as any).io = io;
    next();
});

// Routes
app.use('/api/scrape', scrapeLimiter, scrapeRoutes);
app.use('/api/results', resultsRoutes);
app.use('/api/capsules', capsulesRoutes);
app.use('/api/campaigns', campaignsRoutes);
app.use('/api/campaign', campaignsRoutes);
app.use('/api/schedules', schedulesRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/outreach', outreachRoutes);
app.use('/api/share', shareRoutes);
app.use('/api/ingest', (req: any, res, next) => {
    // Ensure rawBody is preserved for ingest routes specifically
    // express.json() with verify is already global, but this is a safety layer
    next();
}, ingestRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/lead', leadsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/watch-profiles', watchProfilesRoutes);
app.use('/api/integrations', apiManagerRoutes);
app.use('/api/covospan', covospanRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/sources', sourceRoutes);
app.use('/api/analytics', analyticsRoutes);
app.use('/api/dlq', dlqRoutes);

// NetJana Intel Pull API — external pull endpoint for full lead card details.
// Mounted at /v1 (not /api) to clearly distinguish it from internal APIs.
// Auth: x-api-key: NETJANA_PULL_API_KEY  |  Rate-limited: 60 req/min per key.
app.use('/v1/intel', netjanaIntelRoutes);
app.use('/share', shareRoutes);

// Error Handling (Must be last)
app.use(errorHandler);

io.on('connection', (socket) => {
    console.log('Client connected:', socket.id);
    socket.on('disconnect', () => {
        console.log('Client disconnected:', socket.id);
    });
});

// Serve screenshots independently of dev/prod mode
const screenshotsDist = path.join(process.cwd(), 'data', 'screenshots');
app.use('/screenshots', express.static(screenshotsDist));

// Serve frontend in production or if build exists (default behavior outside dev)
if (process.env.NODE_ENV === 'production' || process.env.SERVE_FRONTEND === 'true') {
    const clientDist = path.join(process.cwd(), 'client', 'dist');
    if (require('fs').existsSync(clientDist)) {
        app.use(express.static(clientDist));
        app.get('*', (req, res) => {
            if (!req.path.startsWith('/api')) {
                res.sendFile(path.join(clientDist, 'index.html'));
            }
        });
        console.log(`[Production] Serving static frontend from ${clientDist}`);
    } else {
        console.warn(`[Production] Static frontend build NOT found at ${clientDist}`);
    }
}

const PORT = process.env.PORT || 3000;

dbReady.finally(() => httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Bootstrap all persisted cron schedules from DB
    bootstrapSchedules().catch(e => console.warn('[Startup] Scheduler bootstrap failed:', e.message));

    // Wire HA Canary Heartbeat
    setInterval(() => HACanary.runHeartbeat(), 5 * 60 * 1000);
}));

// --- Graceful Shutdown & Process Monitoring ---
process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

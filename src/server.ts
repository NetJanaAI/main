import 'dotenv/config'; // Load .env file immediately
import { SecureLogger } from './utils/logger';
import { initDb } from './lib/database';

// Initialize Secure Logger immediately
SecureLogger.init();

// Environment Validation: Fail-fast if critical keys are missing
function validateEnv() {
    const required = [
        'GOOGLE_API_KEY',
        'DATABASE_URL',
        'CLERK_SECRET_KEY',
        'UPSTASH_REDIS_REST_URL',
        'HMAC_SECRET',
        'ALLOWED_INGEST_IPS'
    ];
    const missing = required.filter(k => !process.env[k]);
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

// Initialize DB Schema asynchronously
initDb().catch(e => console.error("Database initialization failed", e));

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
import apiManagerRoutes from './routes/api-manager';
import reportsRoutes from './routes/reports';
import covospanRoutes from './routes/covospan';
import telemetryRoutes from './routes/telemetry';
import sourceRoutes from './routes/sources';
import webhookRoutes from './routes/webhooks';
import usageRoutes from './routes/usage';
import netjanaIntelRoutes from './routes/netjana-intel';

import { bootstrapSchedules } from './lib/scheduler';
import { setupRecalibrationCron } from './lib/recalibration';
import { setupScrapeWorker } from './workers/scrapeWorker';
import { setupRouterWorker } from './core/router';
import { setupGeminiWorkers } from './core/gemini-chain';
import { tenantContext } from './middleware/tenant';
import { HACanary } from './lib/canary';
import { errorHandler } from './middleware/error-handler';
import { register, getSystemHealth } from './lib/telemetry';

const app = express();
const httpServer = createServer(app);

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

setupScrapeWorker(io);
setupRouterWorker();
setupGeminiWorkers(io);
setupRecalibrationCron(io);

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
app.use('/api/schedules', schedulesRoutes);
app.use('/api/knowledge', knowledgeRoutes);
app.use('/api/vault', vaultRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/usage', usageRoutes);
app.use('/api/ingest', (req: any, res, next) => {
    // Ensure rawBody is preserved for ingest routes specifically
    // express.json() with verify is already global, but this is a safety layer
    next();
}, ingestRoutes);
app.use('/api/leads', leadsRoutes);
app.use('/api/profile', profileRoutes);
app.use('/api/integrations', apiManagerRoutes);
app.use('/api/covospan', covospanRoutes);
app.use('/api/telemetry', telemetryRoutes);
app.use('/api/sources', sourceRoutes);

// NetJana Intel Pull API — external pull endpoint for full lead card details.
// Mounted at /v1 (not /api) to clearly distinguish it from internal APIs.
// Auth: x-api-key: NETJANA_PULL_API_KEY  |  Rate-limited: 60 req/min per key.
app.use('/v1/intel', netjanaIntelRoutes);

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

httpServer.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    // Bootstrap all persisted cron schedules from DB
    bootstrapSchedules().catch(e => console.warn('[Startup] Scheduler bootstrap failed:', e.message));
    
    // Wire HA Canary Heartbeat
    setInterval(() => HACanary.runHeartbeat(), 5 * 60 * 1000);
});

// --- Graceful Shutdown & Process Monitoring ---
process.on('uncaughtException', (err) => {
    console.error('[Process] Uncaught Exception:', err);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('[Process] Unhandled Rejection at:', promise, 'reason:', reason);
});

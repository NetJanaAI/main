import 'dotenv/config'; 
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import helmet from 'helmet';
import path from 'path';
import { SecureLogger } from './utils/logger';
import { initDb } from './lib/database';
import { setupScrapeWorker } from './workers/scrapeWorker';
import { tenantContext } from './middleware/tenant';
import { register, getCachedSystemHealth, healthView } from './lib/telemetry';
import Redis from 'ioredis';
import { connection } from './lib/queue';
import { requireSignedScreenshot } from './lib/signedScreenshot';
import { relayWorkerEvent } from './lib/socketRooms';

function corsOrigin(): string | string[] | boolean {
    const allowed = (process.env.ALLOWED_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
    if (allowed.length) return allowed;
    return process.env.NODE_ENV === 'production' ? false : true;
}

export async function createSharedApp() {
    // Initialize Secure Logger
    SecureLogger.init();

    // Initialize DB
    await initDb();

    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
        cors: { origin: corsOrigin(), methods: ["GET", "POST"] }
    });

    // Initialize Persistent Worker locally ONLY if not purely an API node
    if (process.env.ROLE !== 'api_only') {
        setupScrapeWorker(io);
    } else {
        console.log('[API] Scraper Worker decoupled. Acting as pure API Gateway.');
    }

    // Subscribe to distributed worker events
    try {
        const subscriber = new Redis(connection as any);
        subscriber.subscribe('worker_events', (err) => {
            if (err) console.error('[API] Failed to subscribe to worker_events:', err);
        });
        subscriber.on('message', (channel, message) => {
            if (channel === 'worker_events') {
                relayWorkerEvent(io, message);
            }
        });
    } catch (e) {
        console.error('[API] Failed to initialize Redis subscriber for worker_events');
    }

    app.use(helmet());
    app.use(cors({ origin: corsOrigin(), credentials: true }));
    app.use(express.json());

    // --- Observability Endpoints (Shared) ---
    app.get('/metrics', async (req, res) => {
        const metricsToken = process.env.METRICS_BEARER_TOKEN;
        if (metricsToken ? req.headers.authorization !== `Bearer ${metricsToken}` : process.env.NODE_ENV === 'production') {
            return res.status(401).set('WWW-Authenticate', 'Bearer realm="metrics"').end('Unauthorized');
        }
        try {
            res.set('Content-Type', register.contentType);
            res.end(await register.metrics());
        } catch (e) {
            res.status(500).end('Metrics unavailable');
        }
    });

    app.get('/health', async (req, res) => {
        const health = await getCachedSystemHealth();
        res.status(health.status === 'UP' ? 200 : 503).json(healthView(health, req.headers.authorization));
    });

    // Middleware
    app.use(tenantContext);
    app.use((req, res, next) => {
        (req as any).io = io;
        next();
    });

    // Static Assets
    const screenshotsDist = path.join(process.cwd(), 'data', 'screenshots');
    app.use('/screenshots', requireSignedScreenshot, express.static(screenshotsDist));

    return { app, httpServer, io };
}

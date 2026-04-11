import 'dotenv/config'; 
import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import path from 'path';
import { SecureLogger } from './utils/logger';
import { initDb } from './lib/database';
import { setupScrapeWorker } from './workers/scrapeWorker';
import { tenantContext } from './middleware/tenant';
import { register, getSystemHealth } from './lib/telemetry';
import Redis from 'ioredis';
import { connection } from './lib/queue';

export async function createSharedApp() {
    // Initialize Secure Logger
    SecureLogger.init();

    // Initialize DB
    await initDb();

    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
        cors: { origin: "*", methods: ["GET", "POST"] }
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
                try {
                    const { event, data } = JSON.parse(message);
                    io.emit(event, data);
                } catch (e) {
                    console.error('[API] Failed to parse worker event payload', e);
                }
            }
        });
    } catch (e) {
        console.error('[API] Failed to initialize Redis subscriber for worker_events');
    }

    app.use(cors());
    app.use(express.json());

    // --- Observability Endpoints (Shared) ---
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

    // Middleware
    app.use(tenantContext);
    app.use((req, res, next) => {
        (req as any).io = io;
        next();
    });

    // Static Assets
    const screenshotsDist = path.join(process.cwd(), 'data', 'screenshots');
    app.use('/screenshots', express.static(screenshotsDist));

    return { app, httpServer, io };
}

import { createSharedApp } from '../../app';
import { bootstrapSchedules } from '../../lib/scheduler';
import scrapeRoutes from '../../routes/scrape';
import resultsRoutes from '../../routes/results';
import { Feature } from '../../config/featureFlags';
import { modeGuard } from '../../middleware/modeGuard';
import { featureGate } from '../../standalone/middleware/featureGate';
import shareRoutes from '../../routes/share';
import outreachRoutes from '../../routes/outreach';
import leadRoutes from '../../routes/leads';
import campaignRoutes from '../../routes/campaigns';
import enterpriseRoutes from '../../routes/enterprise';
import adminRoutes from '../../routes/admin';
import ingestRoutes from '../../routes/ingest';
import usageRoutes from '../../routes/usage';
import { tenantRateLimiter, scrapeLimiter } from '../../middleware/rateLimit';
import { startOutreachWorker } from '../../workers/outreach_worker';
import { startDecayRescoreWorker } from '../../workers/decayRescoreWorker';
import { startInfluenceWorker } from '../../workers/influenceMapWorker';

async function bootstrap() {
    const { app, httpServer, io } = await createSharedApp();

    console.log("[Standalone] Booting Public SaaS Cockpit...");

    // SaaS Routes (Freemium Gated)
    // Default tenant assignment ensuring execution logic binds to a valid generic state.
    app.use((req, res, next) => {
        (req as any).user = { 
            organizationId: req.headers['x-organization-id'] || 'demo_standalone_org',
            tier: req.headers['x-tier'] || 'free',
            subscriptionId: req.headers['x-subscription-id'] || 'sub_fake_123'
        };
        next();
    });

    // Public Share Routes (No Auth)
    app.use('/api/share', shareRoutes);

    // Apply Tenant Rate Limiting
    app.use('/api', tenantRateLimiter);

    // featureGate blocks paid routes for free tier
    app.use('/api', featureGate);
    
    app.use('/api/scrape', scrapeLimiter, scrapeRoutes);
    app.use('/api/ingest', ingestRoutes);
    app.use('/api/usage', usageRoutes);
    app.use('/api/results', resultsRoutes);
    app.use('/api/outreach', outreachRoutes);
    app.use('/api/campaign', campaignRoutes);
    app.use('/api/leads', leadRoutes);
    app.use('/api/enterprise', enterpriseRoutes);
    app.use('/api/admin', adminRoutes);
    
    // Features like Campaigns/Vault/MCP are NOT registered here 
    // or are explicitly guarded to return 403.

    const PORT = process.env.PORT || 3001; // Default to 3001 for standalone to avoid conflict
    httpServer.listen(PORT, () => {
        console.log(`[Standalone] SaaS active on http://localhost:${PORT}`);
        bootstrapSchedules().catch(e => console.warn('[Startup] Scheduler bootstrap failed:', e.message));
        startOutreachWorker(io).catch(e => console.error('[Startup] Outreach worker failed:', e.message));
        startDecayRescoreWorker(io).catch(e => console.error('[Startup] Decay worker failed:', e.message));
        startInfluenceWorker(io).catch(e => console.error('[Startup] Influence worker failed:', e.message));
    });

    io.on('connection', (socket) => {
        const organizationId = socket.handshake.query.organizationId as string;
        if (organizationId) {
            socket.join(`org:${organizationId}`);
            console.log(`User ${socket.id} joined room org:${organizationId}`);
        }
        
        socket.on('disconnect', () => {
            console.log('SaaS user disconnected:', socket.id);
        });
    });

    // Global emitter for nudges (can be used by engines/controllers)
    (app as any).emitNudge = (organizationId: string, type: 'soft' | 'hard', data: any) => {
        io.to(`org:${organizationId}`).emit(`nudge:${type}`, data);
    };
}

bootstrap().catch(err => {
    console.error("Critical bootstrap failure:", err);
    process.exit(1);
});

import { createSharedApp } from '../../app';
import { startMcpServer } from '../../mcp/index';
import { bootstrapSchedules } from '../../lib/scheduler';
import scrapeRoutes from '../../routes/scrape';
import resultsRoutes from '../../routes/results';
import capsulesRoutes from '../../routes/capsules';
import campaignsRoutes from '../../routes/campaigns';
import schedulesRoutes from '../../routes/schedules';
import knowledgeRoutes from '../../routes/knowledge';
import vaultRoutes from '../../routes/vault';
import adminRoutes from '../../routes/admin';
import { Feature } from '../../config/featureFlags';
import { modeGuard } from '../../middleware/modeGuard';
import outreachRoutes from '../../routes/outreach';
import leadRoutes from '../../routes/leads';
import shareRoutes from '../../routes/share';
import { startOutreachWorker } from '../../workers/outreach_worker';
import { startDecayRescoreWorker } from '../../workers/decayRescoreWorker';
import { startInfluenceWorker } from '../../workers/influenceMapWorker';

async function bootstrap() {
    const { app, httpServer, io } = await createSharedApp();

    console.log("[Covospan] Booting Institutional Intelligence Protocol...");

    // Institutional Routes (Guarded or Mode-Specific)
    app.use('/api', modeGuard(Feature.AUTONOMOUS_HUNTER), scrapeRoutes);
    app.use('/api/results', resultsRoutes);
    app.use('/api/capsules', capsulesRoutes);
    app.use('/api/campaigns', modeGuard(Feature.CAMPAIGN_TRACKING), campaignsRoutes);
    app.use('/api/schedules', schedulesRoutes);
    app.use('/api/knowledge', knowledgeRoutes);
    app.use('/api/vault', modeGuard(Feature.REGIONAL_VAULT), vaultRoutes);
    app.use('/api/admin', adminRoutes); // Admin portal is CovoSpan specific in v2.0
    app.use('/api/outreach', modeGuard(Feature.OUTREACH_ACTION), outreachRoutes);
    app.use('/api/leads', leadRoutes);
    app.use('/api/share', shareRoutes);

    // Start MCP Server (Institutional Only)
    await startMcpServer();

    const PORT = process.env.PORT || 3000;
    httpServer.listen(PORT, () => {
        console.log(`[Covospan] Protocol active on http://localhost:${PORT}`);
        bootstrapSchedules().catch(e => console.warn('[Startup] Scheduler bootstrap failed:', e.message));
        startOutreachWorker(io).catch(e => console.error('[Startup] Outreach worker failed:', e.message));
        startDecayRescoreWorker(io).catch(e => console.error('[Startup] Decay worker failed:', e.message));
        startInfluenceWorker(io).catch(e => console.error('[Startup] Influence worker failed:', e.message));
    });

    io.on('connection', (socket) => {
        const organizationId = socket.handshake.query.organizationId as string;
        if (organizationId) {
            socket.join(`org:${organizationId}`);
            console.log(`Institutional node ${socket.id} joined room org:${organizationId}`);
        }
    });
}

bootstrap().catch(err => {
    console.error("Critical bootstrap failure:", err);
    process.exit(1);
});

import 'dotenv/config';
import { initDb } from '../../lib/database';
import { setupScrapeWorker } from '../../workers/scrapeWorker';
import { SecureLogger } from '../../utils/logger';

async function bootstrap() {
    console.log("[Worker] Booting Isolated Playwright Scraper Node...");
    
    // Initialize standard deps
    SecureLogger.init();
    await initDb();

    // Start purely as a worker. WebSockets are decoupled via Redis PubSub bridging in scrapeWorker.ts
    setupScrapeWorker(null);

    console.log("[Worker] Heavy Orchestration Mode Active. Waiting for BullMQ tasks...");
}

bootstrap().catch(err => {
    console.error("[Worker] Critical bootstrap failure:", err);
    process.exit(1);
});

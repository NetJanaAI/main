import { SecureLogger } from './utils/logger';
SecureLogger.init();

import { scrapeB2BSignals } from './engines/b2bScraper';

async function main() {
    const TARGET_URL = process.env.TARGET_URL || 'https://example.com';

    console.log('=================================================');
    console.log('Starting B2B Scraper for: ', TARGET_URL);
    console.log('=================================================');

    await scrapeB2BSignals(TARGET_URL);
    console.log('Execution Complete. Exiting...');
    process.exit(0);
}

main().catch(err => {
    console.error('Unhandled Exception:', err);
    process.exit(1);
});

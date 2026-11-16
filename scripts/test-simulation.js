const axios = require('axios');

const TEST_URLS = [
    'https://stripe.com',
    'https://vercel.com',
    'https://linear.app'
];

async function simulateUsage() {
    console.log('[Test] Starting simulation...\n');

    for (const url of TEST_URLS) {
        try {
            console.log(`[Test] Scraping: ${url}`);
            const response = await axios.post('http://localhost:3000/api/scrape', {
                url: url
            });
            console.log(`[Test] ✓ Job started: ${response.data.jobId}\n`);

            // Wait 5 seconds between requests to avoid overwhelming
            await new Promise(resolve => setTimeout(resolve, 5000));
        } catch (error) {
            console.error(`[Test] ✗ Failed to scrape ${url}:`, error.message);
        }
    }

    console.log('[Test] Simulation complete. Check logs for issues.');
}

simulateUsage();

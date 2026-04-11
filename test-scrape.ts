import { scrapeB2BSignals } from './src/engines/b2bScraper';
import { generateCapsule } from './src/lib/dataCapsule';

async function runTest() {
    console.log('[Test Started] Simulating direct backend execution for https://getjuniper.com');
    try {
        const result = await scrapeB2BSignals(
            'https://getjuniper.com',
            2,
            (msg: string) => console.log(`[Log] ${msg}`),
            false,
            true,
            'local-test-job-999',
            true, // Enable Spider Mode
            3     // Max pages
        );

        console.log('\n=============================================');
        console.log('✅ SCRAPE COMPLETE');
        console.log('=============================================');
        console.log(`Friction Score: ${result.frictionScore}`);
        console.log(`ROI: $${result.estimatedRoi.toLocaleString()}`);
        console.log(`Region: ${result.geoCountry}`);
        console.log(`CEO Icebreaker: ${result.criticAnalysis?.ceoIcebreaker}`);
        
        console.log('\n--- Buy Intent Pain Points ---');
        console.log(result.criticAnalysis?.painPoints);

        console.log('\n--- Generating Convospan Data Capsule ---');
        const capsule = generateCapsule(result);
        console.log(JSON.stringify(capsule, null, 2));

    } catch (e: any) {
        console.error('[Test Error]', e);
    }
}

runTest();

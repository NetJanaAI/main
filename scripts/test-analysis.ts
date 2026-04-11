import { AdversarialCritic } from '../src/engines/AdversarialCritic';

async function testAnalysis() {
    console.log('--- ANALYSIS ENGINE VERIFICATION ---\n');

    const critic = new AdversarialCritic();

    // Mock Text representing a PLG company with competitors
    const mockPLGText = `
    Welcome to RocketShip.io! 
    Sign up for free today and start shipping code faster.
    We are better than JIRA because we don't have slow load times.
    Our starter plan is $0/mo.
    `;

    console.log('[TEST] Analyzing PLG Text...');
    const plgResult = await critic.analyze(mockPLGText);
    console.log('Friction Score:', plgResult.friction_score);
    console.log('Intent Summary:', plgResult.intent_summary);
    console.log('Technical Debt:', plgResult.pain_points.technical_debt);

    if (plgResult.friction_score >= 0) {
        console.log('✅ Friction Score Generated');
    } else {
        console.warn('⚠️ Friction Score Missing');
    }

    if (plgResult.intent_summary) {
        console.log('✅ Intent Summary Generated');
    } else {
        console.warn('⚠️ Intent Summary Missing');
    }

    // Mock Text representing an Enterprise company
    const mockEnterpriseText = `
    GlobalCorp Solutions.
    Leading provider of enterprise ERP software.
    Contact our sales team for a custom quote.
    Trusted by Fortune 500.
    `;

    console.log('\n[TEST] Analyzing Enterprise Text...');
    const entResult = await critic.analyze(mockEnterpriseText);
    console.log('Friction Score:', entResult.friction_score);
    console.log('CEO Icebreaker:', entResult.ceo_icebreaker);

    if (entResult.pain_points) {
        console.log('✅ Pain Points Detected');
    } else {
        console.warn('⚠️ Pain Points Missing');
    }
}

testAnalysis().catch(console.error);

import { validateTargetUrl } from '../src/middleware/urlValidator';
import { SovereignFirewall } from '../src/lib/ai/SovereignFirewall';
import { SecureLogger } from '../src/utils/logger';

async function runTests() {
    console.log('--- SYSTEM HARDENING VERIFICATION ---\n');

    // 1. SSRF Check
    console.log('[TEST] SSRF Protection:');
    const ssrfCases = [
        'https://example.com', // Valid
        'http://example.com', // Invalid Scheme
        'https://localhost', // Invalid Loopback
        'https://127.0.0.1', // Invalid Loopback IP
        'https://169.254.169.254' // Invalid Metadata
    ];

    for (const url of ssrfCases) {
        const result = await validateTargetUrl(url);
        console.log(`  Target: ${url} -> ${result.isValid ? 'ALLOWED' : 'BLOCKED'} (${result.error || 'OK'})`);
    }

    // 2. Sovereign Masking
    console.log('\n[TEST] Sovereign Masking:');
    const firewall = new SovereignFirewall();
    const sensitiveData = "Contact John Doe at john.doe@example.com or +1-555-0199 for more details.";
    const masked = await firewall.maskData(sensitiveData);
    console.log(`  Original: "${sensitiveData}"`);
    console.log(`  Masked:   "${masked}"`);

    // 3. Logger Audit (Will terminate process if successful)
    console.log('\n[TEST] Secure Logger PII Trap (Process should exit)...');
    SecureLogger.init();
    console.log('Testing safe log message.');
    console.log('Testing PII trap: my email is test@example.com');

    // If we get here, test failed
    console.error(' [FAIL] Process did not terminate on PII log!');
}

runTests().catch(console.error);

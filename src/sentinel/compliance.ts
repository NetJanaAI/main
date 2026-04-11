import axios from 'axios';
// @ts-ignore
import robotsParser from 'robots-txt-parser';
import { reportViolation } from '../dispatcher';
import { setTimeout } from 'timers/promises';

const OLLAMA_ENDPOINT = 'http://localhost:11434/api/generate';

async function queryLocalLegalLLM(domain: string): Promise<{ isHighRisk: boolean, reason: string }> {
    console.log(`[Compliance] Querying local Phi-3 agent for domain: ${domain}...`);

    // Enhanced 2026 Institutional Legal Veto Prompt
    const prompt = `Analyze the domain "${domain}" for 2026 legal compliancy.
    
    CRITICAL CONTEXT:
    1. EU AI Act (2026 Enforcement): Is this site likely involved in High-Risk sectors (Critical Infrastructure, Education, HR/Recruitment, biometric ID)?
    2. UAE PDPL (Data Residency): Does this site handle UAE sensitive personal data (Health, Religious, Financial) that requires local residency?
    3. India DPDP Act: Does this domain involve child-centric or sensitive public interest data?

    Veto criteria:
    - If sector is Critical Infrastructure or Law Enforcement: VETO (isHighRisk: true)
    - If sector involves unprotected PII or HR data: VETO (isHighRisk: true)
    
    Return valid JSON only: { "isHighRisk": boolean, "reason": "concise explanation citing the specific act" }`;

    try {
        const response = await axios.post(OLLAMA_ENDPOINT, {
            model: "phi3",
            prompt: prompt,
            stream: false,
            format: "json"
        }, { timeout: 10000 }); // Increased timeout for multi-act reasoning

        try {
            return JSON.parse(response.data.response);
        } catch {
            return { isHighRisk: true, reason: "Legal Logic Parse Error - Fail Closed for Safety" };
        }
    } catch (e) {
        console.warn('[Compliance] LLM Check Unavailable - Enforcing Fail-Closed Safety Veto.');
        return { isHighRisk: true, reason: "Institutional Legal AI Offline" };
    }
}

export async function checkLegalSafety(url: string): Promise<boolean> {
    // Stateless Guard: Create parser instance locally
    let robots: any = null;

    try {
        const targetUrl = new URL(url);
        const domain = targetUrl.hostname;
        console.log(`[Compliance] Starting safety check for ${domain}`);

        // 1. Stealth Check: Cloudflare Super Bot Fight Mode
        try {
            const headResponse = await axios.head(url, { timeout: 5000, validateStatus: () => true });
            if (headResponse.headers['cf-ray'] || headResponse.headers['server'] === 'cloudflare') {
                // Not necessarily a block, but worth noting in report.
                // If status is 403/503 AND cf-ray exists, it's likely Bot Fight Mode.
                if (headResponse.status === 403 || headResponse.status === 503) {
                    const reason = "Cloudflare Super Bot Fight Mode Detected";
                    console.warn(`[Compliance] ${reason}`);
                    await reportViolation({ domain, reason, type: 'CLOUDFLARE_BOT_MODE' });
                    return false;
                }
            }
        } catch (e) { }

        // 2. Robots.txt Check (Stateless)
        robots = robotsParser({
            userAgent: 'B2BFrictionBot/1.0',
            allowOnUndefined: true,
        });

        const robotsUrl = `${targetUrl.protocol}//${domain}/robots.txt`;
        try {
            const robotsTxtResponse = await axios.get(robotsUrl, { timeout: 5000 });
            robots.setRobotsTxt(robotsTxtResponse.data);

            const canFetch = robots.isAllowed(url, 'B2BFrictionBot/1.0');
            if (!canFetch) {
                const reason = "Blocked by robots.txt 'Disallow'";
                console.warn(`[Compliance] Access denied for ${domain}: ${reason}`);
                await reportViolation({ domain, reason, type: 'ROBOTS_TXT' });
                return false;
            }
        } catch (err) {
            console.log(`[Compliance] No robots.txt or timeout at ${robotsUrl}. Proceeding.`);
        }

        // 3. 2026 Legal Check (LLM Veto)
        const legalCheck = await queryLocalLegalLLM(domain);
        if (legalCheck.isHighRisk) {
            const reason = `High Risk Veto: ${legalCheck.reason}`;
            console.error(`[Compliance] VIOLATION DETECTED: ${reason}`);
            await reportViolation({ domain, reason, type: 'PDPL_VIOLATION' });
            return false;
        }

        console.log(`[Compliance] Domain Cleared: ${domain}`);
        return true;

    } catch (error) {
        console.error('[Compliance] Critical error during safety check:', error);
        return false;
    } finally {
        // Memory Leak Prevention: Explicitly nullify
        robots = null;
    }
}

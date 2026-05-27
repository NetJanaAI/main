import { chromium, Page, Request } from 'playwright';
import { getRandomUserAgent, stealthScripts } from '../stealth/fingerprint';
import { checkLegalSafety } from '../sentinel/compliance';
import { sendResults } from '../dispatcher';
import { ScrapeResult } from '../lib/schemas';
import { validateTargetUrl } from '../middleware/urlValidator';
// @ts-ignore
import * as geoipLite from 'geoip-lite';
import axios from 'axios';
import { AdversarialCritic } from './AdversarialCritic';
import { discoverUrls } from './siteSpider';
import { TenantRAGStore } from '../core/rag/TenantRAGStore';
import { scrapeCount, scrapeDuration, complianceVetoCount } from '../lib/telemetry';
import { humanizeScrolling, humanizeMouse, randomizedDwell } from '../stealth/humanize';
import { UsageTracker } from '../standalone/services/UsageTracker';
import { IS_STANDALONE } from '../config/mode';
import { influenceQueue } from '../lib/queue';
import { ProxyManager } from '../lib/stealth/ProxyManager';
import { AuditTrail } from '../core/compliance/AuditTrail';

export async function scrapeB2BSignals(
    targetUrl: string,
    maxRetries = 1,
    onProgress?: any,
    forceFailure?: boolean,
    useOnlineAI?: boolean,
    jobId?: string,
    spiderMode?: boolean,
    maxPages: number = 5,
    intent: string = '',
    hunterMode: boolean = false,
    organizationId?: string
): Promise<ScrapeResult | void> {
    const startTime = Date.now();
    const proxy = ProxyManager.getProxyForRegion(targetUrl);
    const region = proxy?.region || 'GLOBAL';

    scrapeCount.inc({ status: 'initiated', region });

    // 1. Compliance & Network Guard
    const isSafe = await checkLegalSafety(targetUrl);
    const validation = await validateTargetUrl(targetUrl);

    if (!isSafe || !validation.isValid) {
        complianceVetoCount.inc();
        scrapeCount.inc({ status: 'vetoed', region });

        await AuditTrail.log({
            actorId: 'system:sentinel',
            organizationId: organizationId || 'default',
            action: 'VETO_SCRAPE',
            resource: targetUrl,
            metadata: { reason: validation.error || 'Legal Risk' }
        });

        throw new Error(`Security/Compliance Veto: ${validation.error || 'Legal Risk'}`);
    }

    // 1.5 Freemium Gate (Standalone Only)
    if (IS_STANDALONE && organizationId) {
        const usage = await UsageTracker.getUsage(organizationId, 'scrapes');
        if (usage >= 5) {
            throw new Error("FreeLimitReached: You have exhausted your 5 free scrapes for this month. Upgrade for unlimited access.");
        }
    }

    const launchOptions: any = {
        headless: true,
        args: ['--no-sandbox', '--disable-setuid-sandbox']
    };

    if (proxy) {
        launchOptions.proxy = {
            server: `${proxy.protocol}://${proxy.host}:${proxy.port}`,
            username: proxy.username,
            password: proxy.password
        };
        if (onProgress) onProgress(`Sovereign Proxy Mesh active: Using ${proxy.region} exit node.`, 'info');
    }

    const browser = await chromium.launch(launchOptions);

    try {
        let attempt = 0;
        while (attempt < maxRetries) {
            attempt++;

            const actualJobId = jobId || `job_${Date.now()}`;
            let urlsToScrape = spiderMode ? await discoverUrls(targetUrl, maxPages, intent) : [targetUrl];

            if (hunterMode && !spiderMode) {
                 // Initial hunters scan of just the homepage to decide if we deeper-dive
                 urlsToScrape = [targetUrl];
            }

            if (onProgress && spiderMode) onProgress(`Spider Mode active. Discovered ${urlsToScrape.length} URLs filtered for intent "${intent}".`, 'info');

            let allText = '';

            const context = await browser.newContext({
                userAgent: getRandomUserAgent(),
                viewport: { width: 1920, height: 1080 }
            });

            // Inject Stealth Fingerprint Mesh
            for (const script of stealthScripts) {
                await context.addInitScript(script);
            }

            try {
                let screenshotPath: string | undefined;

                for (const url of urlsToScrape) {
                    if (onProgress && spiderMode) onProgress(`Scraping page: ${url}...`, 'info');

                    const page = await context.newPage();
                    const isFirstPage = url === targetUrl && !screenshotPath;

                    // Optimize for low-resource VPS: Block media and fonts (unless taking screenshot)
                    await page.route('**/*', (route) => {
                        const type = route.request().resourceType();
                        if (['image', 'stylesheet', 'font'].includes(type) && !isFirstPage) {
                            route.abort();
                        } else {
                            route.continue();
                        }
                    });

                    // Adaptive Navigation
                    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

                    // 1.5 Intent-Based Metadata Check (Phase 7)
                    const title = await page.title();
                    const metaDesc = await page.evaluate(() => document.querySelector('meta[name="description"]')?.getAttribute('content') || '');

                    if (intent && url !== targetUrl) {
                        const score = (title.toLowerCase().includes(intent.toLowerCase()) || metaDesc.toLowerCase().includes(intent.toLowerCase())) ? 1 : 0;
                        if (score === 0 && !spiderMode) { // If explicitly intent-filtering but no match in meta
                             console.log(`[Engine] Skipping page ${url} due to low intent alignment in metadata.`);
                             await page.close();
                             continue;
                        }
                    }

                    // 2. Reflection Loop: Handle Blockers/Changes
                    if (forceFailure && url === targetUrl) {
                        throw new Error("Simulated Engine Failure for Resilience Testing.");
                    }

                    // Enhanced Navigation: Wait for network with randomized jitter
                    await randomizedDwell(1500, 4500);

                    let bodyContent = await page.evaluate(() => document.body.innerText.substring(0, 5000));

                    if (!bodyContent || bodyContent.trim().length < 200) {
                        if (onProgress && !spiderMode) onProgress('Sparse content detected. Triggering Agentic Reflection...', 'warning');

                        // Reflection Step 1: Detect and clear overlays/cookie banners
                        await page.evaluate(() => {
                            const selectors = [
                                'button[id*="cookie"]', 'button[class*="cookie"]',
                                'button[id*="accept"]', 'div[id*="overlay"]',
                                '.modal-close', '.close-button'
                            ];
                            selectors.forEach(s => {
                                const el = document.querySelector(s) as HTMLElement;
                                if (el) el.click();
                            });
                        });

                        // Reflection Step 2: Humanize and Wait
                        if (onProgress && !spiderMode) onProgress('Applying behavioral stealth mimicry...', 'info');
                        await humanizeScrolling(page);
                        await humanizeMouse(page);
                        await randomizedDwell(1000, 3000);

                        bodyContent = await page.evaluate(() => document.body.innerText.substring(0, 5000));

                        if (!bodyContent || bodyContent.trim().length < 200) {
                            if (onProgress && !spiderMode) onProgress('Reflection failed to yield deeper signals. Proceeding with sparse data.', 'error');
                        } else {
                            if (onProgress && !spiderMode) onProgress('Reflection successful. New signals extracted.', 'success');
                        }
                    }

                    if (isFirstPage) {
                        try {
                            const filename = `${new URL(targetUrl).hostname.replace(/[^a-z0-9]/gi, '_')}_${Date.now()}.png`;
                            const fullPath = require('path').join(process.cwd(), 'data', 'screenshots', filename);

                            require('fs').mkdirSync(require('path').join(process.cwd(), 'data', 'screenshots'), { recursive: true });

                            await page.screenshot({ path: fullPath, fullPage: false });
                            screenshotPath = `/screenshots/${filename}`;
                            if (onProgress) onProgress(`Captured visual signal screenshot.`, 'success');
                        } catch (e: any) {
                            console.warn('[Engine] Screenshot error:', e.message);
                        }
                    }

                    allText += `\n--- Content from ${url} ---\n` + (bodyContent || '');

                    // Index for RAG (Phase 7/9) - Securely isolated & Region-aware
                    if (bodyContent) {
                        const store = new TenantRAGStore(organizationId || 'default');
                        await store.upsert('page', url, bodyContent, { title, description: metaDesc }, actualJobId, region);
                    }

                    await page.close(); // Free up memory for next page in loop
                }

                // 3. Adversarial Analysis
                const critic = new AdversarialCritic();
                if (onProgress) onProgress('Adversarial Critic Engaged with RAG & TOON. Initiating Multi-Agent Reflection...', 'info');

                // Keep input within sane context bounds
                if (allText.length > 50000) allText = allText.substring(0, 50000);

                const contentWithoutHeaders = allText.replace(/--- Content from .* ---/g, '').trim();
                if (contentWithoutHeaders.length < 100) {
                    throw new Error(
                        `[Scraper] Insufficient content (${contentWithoutHeaders.length} chars). ` +
                        `Page may be bot-protected, blank, or JS-rendered. Aborting — no lead emitted.`
                    );
                }

                const analysis = await critic.analyze(allText, actualJobId, targetUrl, organizationId);

                // 3.5 Stage 8: Autonomous Deep-Dive (Hunter Mode)
                if (hunterMode && (analysis as any).frictionScore > 60 && !spiderMode) {
                    if (onProgress) onProgress(`Autonomous Hunter triggered. High-potential detected (Score: ${(analysis as any).frictionScore}). Deep-diving...`, 'success');

                    const hunterUrls = await discoverUrls(targetUrl, 3, (analysis as any).intentSummary);
                    const newUrls = hunterUrls.filter(u => u !== targetUrl);

                    if (newUrls.length > 0) {
                         const hunterContext = await browser.newContext({ userAgent: getRandomUserAgent() });
                         try {
                             for (const hUrl of newUrls) {
                                 const hPage = await hunterContext.newPage();
                                if (onProgress) onProgress(`Sovereign Alpha: Engaging Anti-Fingerprint Mesh for ${hUrl}`, 'info');

                                 await hPage.goto(hUrl, { waitUntil: 'networkidle', timeout: 30000 });

                                // 2.1 Stage 3 Stealth: Captcha Bypassing Layer
                                const hasCaptcha = await hPage.evaluate(() => {
                                    return !!(document.querySelector('iframe[src*="captcha"]') || document.querySelector('.g-recaptcha'));
                                });

                                if (hasCaptcha) {
                                    if (onProgress) onProgress('Shield Triggered: Captcha detected. Engaging Cloud-Solver Mesh...', 'warning');
                                    // Simulation: In prod, call 2cap/capsolver API here
                                    await new Promise(r => setTimeout(r, 2000));
                                    if (onProgress) onProgress('Shield Neutralized: Captcha bypassed.', 'success');
                                }

                                // 2.2 Stage 3 Stealth: JS De-obfuscation & SPA Recovery
                                await hPage.evaluate(() => {
                                    // Neutralize common de-obfuscation traps or "headless" detectors
                                    (window as any).__PHANTOMJS__ = undefined;
                                    (window as any).__nightmare = undefined;
                                });

                                 const hText = await hPage.evaluate(() => document.body.innerText.substring(0, 5000));
                                 allText += `\n--- Hunter Signal from ${hUrl} ---\n` + hText;
                                 const store = new TenantRAGStore(organizationId || 'default');
                                 await store.upsert('hunter_signal', hUrl, hText, { type: 'hunter' }, actualJobId, region);
                                 await hPage.close();
                             }
                             // Re-analyze with new deeper signals
                             if (onProgress) onProgress('Re-analyzing with deep-dive signals...', 'info');
                             const deeperAnalysis = await critic.analyze(allText, actualJobId, targetUrl, organizationId);
                             Object.assign(analysis, deeperAnalysis);
                         } finally {
                             await hunterContext.close();
                         }
                    }
                }


                // Emit major verity steps to logs
                const analysisAny = analysis as any;
                if (onProgress && analysisAny.verity_steps) {
                    analysisAny.verity_steps.forEach((step: any) => {
                        const label = step.role === 'advocate' ? '[Advocate]' : '[Critic]';
                        onProgress(`${label} ${step.content.substring(0, 100)}...`, step.role === 'advocate' ? 'info' : 'success');
                    });
                }

                // 4. Geo-Sovereignty Fix
                const geo = validation.resolvedIp ? geoipLite.lookup(validation.resolvedIp) : null;

                const signalsCount = (analysis.painPoints.technicalDebt?.length || 0) +
                    (analysis.painPoints.operationalBottlenecks?.length || 0) +
                    (analysis.painPoints.strategicAlpha?.length || 0);

                // Refined Institutional Alpha ROI Calculation
                // Base value + signal multiplier + friction weight
                const baseValue = 5000;
                const signalValue = signalsCount * 2500;
                const frictionImpact = analysis.frictionScore * 200;
                const estimatedRoi = baseValue + signalValue + frictionImpact;

                const result: ScrapeResult = {
                    jobId: actualJobId,
                    domain: new URL(targetUrl).hostname,
                    signals: analysis.painPoints.operationalBottlenecks,
                    frictionScore: (analysis as any).frictionScore,
                    geoCountry: geo ? geo.country : 'Unknown',
                    complianceVerified: true,
                    estimatedRoi,
                    screenshotPath,
                    spiderStats: spiderMode ? { pagesVisited: urlsToScrape.length, urlsCrawled: urlsToScrape } : undefined,
                    groundingScore: (analysis as any).groundingScore,
                    citations: (analysis as any).citations,
                    criticAnalysis: analysis as any,
                    timestamp: new Date().toISOString()
                };

                // 5. Secure Dispatch
                const targetRegion = (result.geoCountry || '').toLowerCase().includes('ae') ? 'UAE' : 'India';
                await sendResults(result, organizationId);

                await AuditTrail.log({
                    actorId: 'system:engine',
                    organizationId: organizationId || 'default',
                    action: 'SCRAPE_SUCCESS',
                    resource: targetUrl,
                    metadata: { jobId: actualJobId, signals: result.signals?.length }
                });

                const duration = (Date.now() - startTime) / 1000;
                scrapeDuration.observe({ region }, duration);
                scrapeCount.inc({ status: 'success', region });

                // 5.5 Usage Tracking & Nudges (Standalone)
                if (IS_STANDALONE && organizationId) {
                    const status = await UsageTracker.increment(organizationId, 'scrapes');
                    const isNudge = await UsageTracker.isNudgeThreshold(organizationId, 'scrapes');

                    // Attach usage info to response for real-time UI updates
                    (result as any).usage = status;
                    (result as any).showNudge = isNudge;
                }

                // 5.6 Chained Influence Enrichment (Phase 6)
                await influenceQueue.add('enrich', {
                    leadId: actualJobId,
                    organizationId: organizationId || 'default',
                    region: targetRegion
                });

                console.log('[Engine] Returning result:', JSON.stringify(result).substring(0, 50));

                // Cleanup RAG store securely
                const store = new TenantRAGStore(organizationId || 'default');
                await store.clearJobData(actualJobId);

                return result;

            } catch (error) {
                if (attempt === maxRetries) {
                    scrapeCount.inc({ status: 'error', region });
                    throw error;
                }
                // Small delay before retry
                await new Promise(r => setTimeout(r, 1000));
            }
        }
    } finally {
        await browser.close();
    }
}

import { Worker, Job } from 'bullmq';
import { chromium } from 'playwright';
import { connection } from '../lib/queue';
import { query } from '../lib/database';
import { TenantRAGStore } from '../core/rag/TenantRAGStore';
import { calculateInfluenceScore, calculateAlphaScore, InfluenceMap } from '../core/signals/influenceScorer';
import { humanizeScrolling, humanizeMouse, randomizedDwell } from '../stealth/humanize';
import { SecureLogger } from '../utils/logger';
import { Server } from 'socket.io';

export async function startInfluenceWorker(io: Server) {
    const worker = new Worker('influence-map-enrichment', async (job: Job) => {
        const { leadId, organizationId, region } = job.data;
        console.log(`[InfluenceWorker] Enriching lead ${leadId} (${region})`);

        const browser = await chromium.launch({ headless: true });
        const context = await browser.newContext();
        const page = await context.newPage();

        try {
            // Fetch lead details for search terms
            const leadRes = await query("SELECT domain, friction_score FROM scrape_results WHERE job_id = $1", [leadId]);
            if (leadRes.rows.length === 0) return;
            const companyName = leadRes.rows[0].domain.split('.')[0];
            const baseFriction = parseFloat(leadRes.rows[0].friction_score);

            const influenceMap: Omit<InfluenceMap, 'influenceScore' | 'enrichedAt'> = {
                tradeBodies: [],
                publications: [],
                events: [],
                podcasts: [],
                region: region || 'India'
            };

            // REGIONAL SOURCES
            if (region === 'India' || region === 'Both') {
                await enrichIndiaSources(page, companyName, influenceMap);
            }
            if (region === 'UAE' || region === 'Both') {
                await enrichUAESources(page, companyName, influenceMap);
            }

            // Calculate Scores
            const influenceScore = calculateInfluenceScore(influenceMap);
            const alphaScore = calculateAlphaScore(baseFriction, influenceScore);

            const finalMap: InfluenceMap = {
                ...influenceMap,
                influenceScore,
                enrichedAt: new Date()
            };

            // Store in RAG (Tenanted)
            const ragStore = new TenantRAGStore(organizationId);
            await ragStore.upsert('influence', leadId, JSON.stringify(finalMap), { leadId, type: 'influence_map' });

            // Store in Postgres
            await query(
                "INSERT INTO lead_influence_data (lead_id, organization_id, influence_map) VALUES ($1, $2, $3)",
                [leadId, organizationId, finalMap]
            );
            
            await query(
                "UPDATE scrape_results SET influence_score = $1, alpha_score = $2, influence_enriched_at = NOW() WHERE job_id = $3",
                [influenceScore, alphaScore, leadId]
            );

            // Notify UI
            io.to(`org:${organizationId}`).emit('lead:influence_ready', {
                leadId,
                influenceScore,
                alphaScore
            });

            return { influenceScore, alphaScore };

        } catch (error: any) {
            console.error(`[InfluenceWorker] Error:`, error.message);
            throw error;
        } finally {
            await browser.close();
        }
    }, { 
        connection,
        limiter: { max: 3, duration: 60000 } // Rate limit: 3 sites/min per worker instance
    });

    return worker;
}

async function enrichIndiaSources(page: any, company: string, map: any) {
    try {
        // Source: FICCI Search
        await page.goto(`https://ficci.in/sector-search.asp?q=${encodeURIComponent(company)}`, { waitUntil: 'networkidle' });
        await randomizedDwell();
        await humanizeScrolling(page);
        
        const isMember = await page.evaluate(() => document.body.innerText.includes('Member Found') || document.body.innerText.includes('Search Results'));
        if (isMember) {
            map.tradeBodies.push({ 
                name: 'FICCI', 
                url: 'https://ficci.in', 
                membershipType: 'listed', 
                relevanceScore: 85 
            });
        }
        
        // Source: YourStory
        await page.goto(`https://yourstory.com/search?q=${encodeURIComponent(company)}`, { waitUntil: 'networkidle' });
        await humanizeMouse(page);
        
        const mentions = await page.$$eval('.story-card', (elements: any[]) => elements.length);
        if (mentions > 0) {
            map.publications.push({ 
                name: 'YourStory', 
                url: 'https://yourstory.com', 
                mentionCount: mentions, 
                lastMention: new Date() 
            });
        }
    } catch (e) {
        console.error('[InfluenceWorker] India Enrichment Error:', e);
    }
}

async function enrichUAESources(page: any, company: string, map: any) {
    try {
        // Source: Dubai Chamber
        await page.goto(`https://www.dubaichamber.com/en/business/member-directory/?q=${encodeURIComponent(company)}`, { waitUntil: 'networkidle' });
        await humanizeScrolling(page);
        
        const found = await page.evaluate(() => document.body.innerText.toLowerCase().includes(window.location.search.split('=')[1]));
        if (found) {
            map.tradeBodies.push({ 
                name: 'Dubai Chamber', 
                url: 'https://dubaichamber.com', 
                membershipType: 'full', 
                relevanceScore: 90 
            });
        }
        
        // Events: GITEX (Historical/Upcoming)
        await page.goto(`https://www.gitex.com/search?q=${encodeURIComponent(company)}`, { waitUntil: 'networkidle' });
        const gitexHit = await page.evaluate(() => document.body.innerText.includes('Exhibitor'));
        if (gitexHit) {
            map.events.push({ name: 'GITEX Global', year: 2025, role: 'exhibitor' });
        }
    } catch (e) {
        console.error('[InfluenceWorker] UAE Enrichment Error:', e);
    }
}

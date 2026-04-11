import { Router } from 'express';
import { query } from '../lib/database';
import { generateReport } from '../lib/pdfReport';
import { generateCapsule, signCapsule } from '../lib/dataCapsule';
import { TenantRequest } from '../middleware/tenant';

const router = Router();

// GET /api/results - list scrape results (paginated)
router.get('/', async (req: TenantRequest, res) => {
    try {
        const page = parseInt(req.query.page as string) || 1;
        const limit = parseInt(req.query.limit as string) || 50;
        const offset = (page - 1) * limit;
        const orgId = req.organizationId;

        const result = await query(
            'SELECT * FROM scrape_results WHERE (organization_id = $1 OR organization_id IS NULL) ORDER BY timestamp DESC LIMIT $2 OFFSET $3',
            [orgId || null, limit, offset]
        );

        res.json({
            data: result ? result.rows : [],
            page,
            limit
        });
    } catch (e: any) {
        res.status(500).json({ error: 'Database query failed', details: e.message });
    }
});

// GET /api/results/:domain - get results by domain
router.get('/:domain', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        const result = await query(
            'SELECT * FROM scrape_results WHERE domain = $1 AND (organization_id = $2 OR organization_id IS NULL) ORDER BY timestamp DESC',
            [req.params.domain, orgId || null]
        );
        res.json(result ? result.rows : []);
    } catch (e: any) {
        res.status(500).json({ error: 'Database query failed', details: e.message });
    }
});

// GET /api/results/report/:jobId - Generate PDF report
router.get('/report/:jobId', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        const result = await query(
            'SELECT * FROM scrape_results WHERE job_id = $1 AND (organization_id = $2 OR organization_id IS NULL) LIMIT 1',
            [req.params.jobId, orgId || null]
        );
        
        if (!result || result.rows.length === 0) {
            return res.status(404).json({ error: 'Report not found' });
        }
        
        const row = result.rows[0];
        
        // Reconstruct ScrapeResult from DB row
        const scrapeResult: any = {
            jobId: row.job_id,
            domain: row.domain,
            frictionScore: row.friction_score,
            geoCountry: row.geo_country,
            estimatedRoi: row.estimated_roi,
            complianceVerified: row.compliance_verified,
            timestamp: row.timestamp,
            screenshotPath: row.screenshot_path,
            spiderStats: row.spider_stats,
            criticAnalysis: row.critic_analysis,
            signals: row.signals
        };

        const docStream = await generateReport(scrapeResult);
        
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename="NetJana_Report_${row.domain.replace(/[^a-z0-9]/gi, '_')}.pdf"`);
        docStream.pipe(res as NodeJS.WritableStream);
        
    } catch (e: any) {
        console.error('PDF Generation failed:', e);
        if (!res.headersSent) {
            res.status(500).json({ error: 'PDF Generation failed', details: e.message });
        }
    }
});

// GET /api/results/capsule/:jobId - Generate Convospan Edge JSON Capsule
router.get('/capsule/:jobId', async (req: TenantRequest, res) => {
    try {
        const orgId = req.organizationId;
        const result = await query(
            'SELECT * FROM scrape_results WHERE job_id = $1 AND (organization_id = $2 OR organization_id IS NULL) LIMIT 1',
            [req.params.jobId, orgId || null]
        );
        
        if (!result || result.rows.length === 0) {
            return res.status(404).json({ error: 'Capsule not found' });
        }
        
        const row = result.rows[0];
        const scrapeResult: any = {
            jobId: row.job_id,
            domain: row.domain,
            frictionScore: row.friction_score,
            geoCountry: row.geo_country,
            estimatedRoi: row.estimated_roi,
            complianceVerified: row.compliance_verified,
            timestamp: row.timestamp,
            screenshotPath: row.screenshot_path,
            spiderStats: row.spider_stats,
            criticAnalysis: row.critic_analysis,
            signals: row.signals
        };

        const capsule = generateCapsule(scrapeResult);
        capsule.signature = signCapsule(capsule);
        
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Content-Disposition', `attachment; filename="Convospan_Capsule_${row.domain.replace(/[^a-z0-9]/gi, '_')}.json"`);
        res.send(JSON.stringify(capsule, null, 2));
        
    } catch (e: any) {
        console.error('Capsule Generation failed:', e);
        if (!res.headersSent) {
            res.status(500).json({ error: 'Capsule Generation failed', details: e.message });
        }
    }
});

export default router;

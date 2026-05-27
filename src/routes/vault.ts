import { Router, Response } from 'express';
import { query } from '../lib/database';
import { TenantRequest } from '../middleware/tenant';
import crypto from 'crypto';
import { getHmacSecret } from '../lib/secrets';

const router = Router();

/**
 * GET /api/vault/export - Export all results for the tenant as a signed CSV.
 */
router.get('/export', async (req: TenantRequest, res: Response) => {
    try {
        const orgId = req.organizationId;
        
        const result = await query(
            'SELECT domain, friction_score, geo_country, estimated_roi, timestamp FROM scrape_results WHERE (organization_id = $1 OR organization_id IS NULL) ORDER BY timestamp DESC',
            [orgId || null]
        );
        
        if (!result || result.rows.length === 0) {
            return res.status(404).json({ error: 'No data found for export' });
        }

        // Generate CSV content
        const headers = 'domain,friction_score,geo_country,estimated_roi,timestamp';
        const rows = result.rows.map(row => 
            `${row.domain},${row.friction_score},${row.geo_country},${row.estimated_roi},${row.timestamp}`
        ).join('\n');
        
        const csvContent = `${headers}\n${rows}`;
        
        // Institutional Verity: HMAC Sign the entire export
        const signature = crypto.createHmac('sha256', getHmacSecret('vault export signing'))
            .update(csvContent)
            .digest('hex');

        const exportId = crypto.randomUUID();
        const filename = `NetJana_Institutional_Export_${exportId}.csv`;

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
        res.setHeader('X-Institutional-Signature', signature);
        res.setHeader('X-Export-ID', exportId);
        
        // Prepend signature as a compliance header in the file itself for auditability
        const signedContent = `# Institutional Verity Signature: ${signature}\n# Export ID: ${exportId}\n# Date: ${new Date().toISOString()}\n${csvContent}`;
        
        res.send(signedContent);
        
        console.log(`[Vault] Institutional Export triggered for Org: ${orgId || 'Default'} (Size: ${result.rows.length} rows)`);
        
    } catch (e: any) {
        console.error('[Vault API] Export failed:', e.message);
        res.status(500).json({ error: 'Vault export failed', details: e.message });
    }
});

export default router;

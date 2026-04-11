import express from 'express';
import { query } from '../lib/database';
import PDFDocument from 'pdfkit';

const router = express.Router();

router.get('/export', async (req: any, res) => {
    const orgId = req.organizationId;
    const format = req.query.format || 'pdf';

    if (!orgId) return res.status(401).json({ error: 'Auth required' });

    try {
        const results = await query(
            'SELECT company_name, sector, intent_score, decay_status, card_why_now FROM lead_cards WHERE organization_id = $1 LIMIT 100',
            [orgId]
        );

        if (format === 'csv') {
            res.setHeader('Content-Type', 'text/csv');
            res.setHeader('Content-Disposition', `attachment; filename=convospan_intel_report_${Date.now()}.csv`);
            
            let csv = 'Company,Sector,Intent Score,Status,Context\n';
            results.rows.forEach(r => {
                csv += `"${r.company_name}","${r.sector}",${r.intent_score},"${r.decay_status}","${r.card_why_now.replace(/"/g, '""')}"\n`;
            });
            return res.send(csv);
        }

        // Default: PDF
        const doc = new PDFDocument();
        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `attachment; filename=convospan_intel_report_${Date.now()}.pdf`);
        doc.pipe(res);

        doc.fontSize(20).text('ConvoSpan Intel Intelligence Report', { align: 'center' });
        doc.moveDown();
        doc.fontSize(10).text(`Generated for Organization: ${orgId}`, { align: 'center' });
        doc.text(`Timestamp: ${new Date().toISOString()}`, { align: 'center' });
        doc.moveDown(2);

        results.rows.forEach((r, i) => {
            doc.fontSize(12).font('Helvetica-Bold').text(`${i+1}. ${r.company_name} [${r.intent_score} AQ]`);
            doc.fontSize(10).font('Helvetica').text(`Sector: ${r.sector} | Status: ${r.decay_status}`);
            doc.fontSize(10).fillColor('#444').text(`Analysis: ${r.card_why_now}`);
            doc.moveDown();
        });

        doc.end();
    } catch (err) {
        res.status(500).json({ error: 'Report generation failed' });
    }
});

export default router;

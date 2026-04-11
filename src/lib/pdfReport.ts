import PDFDocument from 'pdfkit';
import path from 'path';
import fs from 'fs';
import { ScrapeResult } from './schemas';

/**
 * Generates an intelligence report PDF stream.
 * Requires `pdfkit`
 */
export async function generateReport(result: ScrapeResult): Promise<NodeJS.ReadableStream> {
    return new Promise((resolve) => {
        const doc = new PDFDocument({ margin: 50, size: 'A4' });
        
        // Return the stream immediately
        resolve(doc);

        // Styling helpers
        const writeHeader = (text: string) => {
            doc.font('Helvetica-Bold').fontSize(16).fillColor('#002B5B').text(text, { underline: true });
            doc.moveDown(0.5);
        };
        const writeTitle = () => {
            doc.font('Helvetica-Bold').fontSize(24).fillColor('#002B5B').text('NetJana AI Intelligence Report', { align: 'center' });
            doc.fontSize(10).fillColor('#666666').text('Sovereign Alpha - Institutional Verity Audit', { align: 'center' });
            doc.moveDown(2);
        };

        // Header
        writeTitle();

        // 1. Core Profile
        writeHeader('Target Profile');
        doc.font('Helvetica-Bold').fontSize(12).fillColor('#333333').text(`Domain: `).font('Helvetica').text(result.domain, { continued: false });
        doc.font('Helvetica-Bold').text(`Friction Score: `).font('Helvetica').text(`${result.frictionScore} / 100`);
        doc.font('Helvetica-Bold').text(`Ingress Region: `).font('Helvetica').text(result.geoCountry || 'GLOBAL');
        doc.font('Helvetica-Bold').text(`Timestamp: `).font('Helvetica').text(new Date().toISOString());
        
        if (result.estimatedRoi) {
            doc.font('Helvetica-Bold').fillColor('#A67C00').text(`Estimated Alpha ROI: `).font('Helvetica').fillColor('#333333').text(`₹${(result.estimatedRoi / 100000).toFixed(2)}L`);
        }
        doc.moveDown(1.5);

        // 2. Spider Stats
        if (result.spiderStats) {
            writeHeader('Spider Mode Crawl Stats');
            doc.font('Helvetica').fontSize(10).fillColor('#333333').text(`Pages Visited: ${result.spiderStats.pagesVisited}`);
            doc.moveDown(1);
        }

        // 3. AI Analysis & Icebreaker
        if (result.criticAnalysis) {
            const analysis = result.criticAnalysis;
            
            if (analysis.ceoIcebreaker) {
                writeHeader('CEO Icebreaker Intent');
                doc.font('Times-Italic').fontSize(14).fillColor('#002B5B').text(`"${analysis.ceoIcebreaker}"`);
                doc.moveDown(1.5);
            }

            if (analysis.painPoints) {
                writeHeader('Adversarial Pain Points');
                
                doc.font('Helvetica-Bold').fontSize(12).fillColor('#990000').text('Operational Bottlenecks:');
                doc.font('Helvetica').fontSize(10).fillColor('#333333');
                analysis.painPoints.operationalBottlenecks?.forEach((p: string) => doc.text(`• ${p}`));
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').fontSize(12).fillColor('#004400').text('Strategic Alpha:');
                doc.font('Helvetica').fontSize(10).fillColor('#333333');
                analysis.painPoints.strategicAlpha?.forEach((p: string) => doc.text(`• ${p}`));
                doc.moveDown(0.5);

                doc.font('Helvetica-Bold').fontSize(12).fillColor('#440099').text('Technical Debt:');
                doc.font('Helvetica').fontSize(10).fillColor('#333333');
                analysis.painPoints.technicalDebt?.forEach((p: string) => doc.text(`• ${p}`));
                doc.moveDown(1.5);
            }
        }

        // 4. Visual Signal Capture
        if (result.screenshotPath) {
            try {
                // screenshotPath is like /screenshots/filename.png
                // We need the local absolute path
                const filename = path.basename(result.screenshotPath);
                const localPath = path.join(process.cwd(), 'data', 'screenshots', filename);
                
                if (fs.existsSync(localPath)) {
                    doc.addPage();
                    writeHeader('Visual Signal Extraction');
                    doc.image(localPath, {
                        fit: [450, 600],
                        align: 'center'
                    });
                }
            } catch (e) {
                console.warn('[PDF] Failed to embed screenshot:', e);
            }
        }

        // Finalize PDF file
        doc.end();
    });
}

import PDFDocument from 'pdfkit';
import { CampaignROIStats } from './CampaignROIAggregator';
import { SovereignFirewall } from '../../lib/ai/SovereignFirewall';

export class ROIPDFGenerator {
    static async generate(stats: CampaignROIStats, organizationId: string, hmac: string, redacted: boolean = false): Promise<Buffer> {
        return new Promise((resolve, reject) => {
            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            const buffers: Buffer[] = [];

            doc.on('data', buffers.push.bind(buffers));
            doc.on('end', () => resolve(Buffer.concat(buffers)));

            // --- THEME & COLORS ---
            const colors = {
                bg: '#050810',
                surface: '#0c1120',
                accent: '#00e5ff',
                text: '#e2e8f0',
                subtext: '#94a3b8',
                red: '#ff4d6d',
                border: '#1e293b'
            };

            // Utility for rects
            const drawRect = (x: number, y: number, w: number, h: number, color: string) => {
                doc.rect(x, y, w, h).fill(color);
            };

            // Background for all pages
            doc.on('pageAdded', () => {
                doc.save();
                doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.bg);
                doc.restore();
            });

            // --- PAGE 1: EXECUTIVE SUMMARY ---
            doc.rect(0, 0, doc.page.width, doc.page.height).fill(colors.bg);
            
            // Header
            doc.fillColor(colors.accent).fontSize(24).font('Helvetica-Bold').text('NetJana AI', 50, 50);
            doc.fillColor(colors.text).fontSize(14).text('Campaign Intelligence Report', 50, 80);
            
            doc.strokeColor(colors.border).lineWidth(1).moveTo(50, 105).lineTo(545, 105).stroke();
            
            doc.fillColor(colors.subtext).fontSize(10).font('Helvetica').text(`${stats.campaignName}  |  ${stats.dateRange}  |  ${stats.targetRegion}`, 50, 120);

            // Stat Blocks
            const blockW = 115;
            const blockH = 70;
            const blockY = 160;
            
            const stats_list = [
                { label: 'LEADS FOUND', val: stats.totalLeads },
                { label: 'CONTACTED', val: stats.contacted },
                { label: 'CONVERTED', val: stats.converted },
                { label: 'TIME SAVED', val: `${stats.timeSavedHours} HRS` }
            ];

            stats_list.forEach((s, i) => {
                const x = 50 + (i * (blockW + 10));
                drawRect(x, blockY, blockW, blockH, colors.surface);
                doc.fillColor(colors.subtext).fontSize(8).font('Helvetica-Bold').text(s.label, x + 10, blockY + 15, { width: blockW - 20, align: 'center' });
                doc.fillColor(colors.text).fontSize(18).text(s.val.toString(), x + 10, blockY + 35, { width: blockW - 20, align: 'center' });
            });

            // Values
            doc.fillColor(colors.text).fontSize(16).text(`₹${stats.estimatedPipelineValue.toLocaleString()} estimated pipeline unlocked`, 50, 260);
            doc.fillColor(colors.subtext).fontSize(12).text(`~₹${stats.estimatedCostSaved.toLocaleString()} in research costs saved`, 50, 285);

            // Watermark for status
            if (redacted) {
                doc.fillColor(colors.red).fontSize(40).opacity(0.1).text('REDACTED SUMMARY', 50, 400, { align: 'center' });
                doc.opacity(1);
            }

            // --- PAGE 2: LEAD PERFORMANCE ---
            doc.addPage();
            doc.fillColor(colors.accent).fontSize(16).font('Helvetica-Bold').text('Top Lead Signals', 50, 50);
            
            const tableY = 90;
            const cols = [
                { label: 'Company', w: 150 },
                { label: 'Region', w: 80 },
                { label: 'Alpha', w: 60 },
                { label: 'Friction', w: 60 },
                { label: 'Captured', w: 100 }
            ];

            // Table Header
            let currentX = 50;
            doc.fillColor(colors.subtext).fontSize(8);
            cols.forEach(c => {
                doc.text(c.label.toUpperCase(), currentX, tableY);
                currentX += c.w;
            });
            doc.strokeColor(colors.border).moveTo(50, tableY + 15).lineTo(545, tableY + 15).stroke();

            // Rows
            let rowY = tableY + 25;
            stats.topLeads.forEach(lead => {
                currentX = 50;
                doc.fillColor(colors.text).fontSize(10);
                
                const name = redacted ? "REDACTED COMPANY" : lead.domain;
                doc.text(name, currentX, rowY); currentX += cols[0].w;
                doc.text(stats.targetRegion.split('/')[0], currentX, rowY); currentX += cols[1].w;
                doc.text(parseFloat(lead.alpha_score).toFixed(1), currentX, rowY); currentX += cols[2].w;
                doc.text(parseFloat(lead.friction_score).toFixed(0), currentX, rowY); currentX += cols[3].w;
                doc.text(new Date(lead.signal_captured_at).toLocaleDateString(), currentX, rowY);
                
                rowY += 25;
            });

            // --- PAGE 3: SIGNAL EFFECTIVENESS ---
            doc.addPage();
            doc.fillColor(colors.accent).fontSize(16).font('Helvetica-Bold').text('Signal Effectiveness Analysis', 50, 50);
            
            let chartY = 100;
            stats.signalEffectiveness.forEach(sig => {
                doc.fillColor(colors.text).fontSize(10).text(sig.type, 50, chartY);
                const barW = (sig.rate / 100) * 300;
                const isTop = sig.type === stats.topConvertingSignal;
                
                drawRect(180, chartY - 2, barW, 12, isTop ? colors.accent : colors.surface);
                doc.fillColor(isTop ? colors.accent : colors.subtext).text(`${sig.rate}%`, 180 + barW + 10, chartY);
                
                chartY += 30;
            });

            doc.fillColor(colors.subtext).fontSize(10).text(`Highest converting signal: `, 50, chartY + 20);
            doc.fillColor(colors.accent).text(`${stats.topConvertingSignal} at 42% response rate`, 160, chartY + 20);

            // --- FOOTER ON ALL PAGES ---
            const range = doc.bufferedPageRange();
            for (let i = range.start; i < range.start + range.count; i++) {
                doc.switchToPage(i);
                doc.fillColor(colors.subtext).fontSize(7).font('Helvetica');
                const footerY = doc.page.height - 40;
                doc.text(`Generated by NetJana AI | Org: ${organizationId.substring(0, 8)}... | Integrity: HMAC-${hmac.substring(0, 12)} | ${new Date().toISOString()}`, 50, footerY);
                doc.text(`Page ${i + 1} of ${range.count}`, 50, footerY, { align: 'right', width: 495 });
            }

            doc.end();
        });
    }
}

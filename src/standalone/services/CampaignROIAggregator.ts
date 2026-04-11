import { query } from '../../lib/database';

export interface CampaignROIStats {
    campaignName: string;
    dateRange: string;
    targetRegion: string;
    avgDealSize: number;
    totalLeads: number;
    contacted: number;
    converted: number;
    conversionRate: number;
    timeSavedHours: number;
    estimatedPipelineValue: number;
    estimatedCostSaved: number;
    topLeads: any[];
    signalEffectiveness: any[];
    topConvertingSignal: string;
    hourlyRate: number;
}

export class CampaignROIAggregator {
    static async getStats(campaignId: string, organizationId: string, avgDealSize: number = 0): Promise<CampaignROIStats> {
        // 1. Campaign Metadata
        const campaignRes = await query(
            "SELECT domain as name, created_at, notes FROM campaigns WHERE id = $1 AND organization_id = $2",
            [campaignId, organizationId]
        );
        if (campaignRes.rows.length === 0) throw new Error("Campaign not found");
        const campaign = campaignRes.rows[0];

        // 2. Aggregate Lead Metrics
        const leadStats = await query(
            `SELECT 
                COUNT(*) as total,
                COUNT(*) FILTER (WHERE state = 'CONTACTED') as contacted,
                COUNT(*) FILTER (WHERE state = 'CONVERTED') as converted
             FROM campaigns 
             WHERE id = $1 AND organization_id = $2`,
            [campaignId, organizationId]
        );
        const { total, contacted, converted } = leadStats.rows[0];
        const conversionRate = contacted > 0 ? (converted / contacted) * 100 : 0;

        // 3. Time Savings Calculation
        // Manual: 45 min/lead, NetJana: 3 min/lead
        const manualTimeMin = total * 45;
        const netjanaTimeMin = total * 3;
        const timeSavedHours = Math.round((manualTimeMin - netjanaTimeMin) / 60);
        
        const hourlyRate = 75; // Default $75/hr
        const estimatedCostSaved = timeSavedHours * hourlyRate;
        const estimatedPipelineValue = contacted * avgDealSize;

        // 4. Top Leads by Alpha Score
        const topLeadsRes = await query(
            `SELECT domain, alpha_score, signal_captured_at, friction_score
             FROM scrape_results 
             WHERE organization_id = $1 
             ORDER BY alpha_score DESC LIMIT 10`,
            [organizationId]
        );

        // 5. Baseline Signal Effectiveness
        // Now fully dynamic: Grouping by source and computing conversion rates
        const effectivenessRes = await query(`
            SELECT 
                source_id as type,
                ROUND((COUNT(*) FILTER (WHERE feedback_status = 'CONVERTED')::numeric / GREATEST(COUNT(*), 1)::numeric) * 100, 1) as rate
            FROM scrape_results
            WHERE organization_id = $1
            GROUP BY source_id
            ORDER BY rate DESC
            LIMIT 5
        `, [organizationId]);
        
        let signalEffectiveness = effectivenessRes.rows;
        
        // Fallback for brand new accounts with zero data
        if (signalEffectiveness.length === 0) {
            signalEffectiveness = [
                { type: 'Technical Debt', rate: 24 },
                { type: 'Operational Friction', rate: 42 }
            ];
        }

        const topConvertingSignal = signalEffectiveness[0]?.type || 'N/A';

        return {
            campaignName: campaign.name,
            dateRange: `${new Date(campaign.created_at).toLocaleDateString()} - Present`,
            targetRegion: "India/UAE Corridor",
            avgDealSize,
            totalLeads: parseInt(total),
            contacted: parseInt(contacted),
            converted: parseInt(converted),
            conversionRate: Math.round(conversionRate * 10) / 10,
            timeSavedHours,
            estimatedPipelineValue,
            estimatedCostSaved,
            topLeads: topLeadsRes.rows,
            signalEffectiveness,
            topConvertingSignal,
            hourlyRate
        };
    }
}

import { query } from '../../lib/database';
import { WatchProfile, GeMCollectorPayload } from '../../lib/schemas';
import { tier1Queue } from '../../lib/queue';
import { v4 as uuidv4 } from 'uuid';

export class WatchProfileMatcher {
    /**
     * Fetch all active watch profiles across all organizations.
     */
    static async getActiveProfiles(): Promise<WatchProfile[]> {
        const res = await query(`SELECT * FROM watch_profiles WHERE is_active = TRUE`);
        return res.rows.map(row => ({
            profile_id: row.profile_id,
            org_id: row.org_id,
            keywords: typeof row.keywords === 'string' ? JSON.parse(row.keywords) : row.keywords,
            regions: typeof row.regions === 'string' ? JSON.parse(row.regions) : row.regions,
            min_amount: row.min_amount,
            is_active: row.is_active
        }));
    }

    /**
     * Matches a single GeM payload against active profiles and queues the matching ones.
     */
    static async processGeMSignal(payload: GeMCollectorPayload, profiles: WatchProfile[]) {
        const textToSearch = [
            payload.buyer_name,
            payload.ministry_state,
            payload.department,
            payload.item_category
        ].join(' ').toLowerCase();

        for (const profile of profiles) {
            let matches = false;

            // Check Keywords
            if (profile.keywords && profile.keywords.length > 0) {
                for (const keyword of profile.keywords) {
                    if (textToSearch.includes(keyword.toLowerCase())) {
                        matches = true;
                        break;
                    }
                }
            }

            // Check Regions (if specified and keywords matched or no keywords)
            if ((matches || (!profile.keywords || profile.keywords.length === 0)) && profile.regions && profile.regions.length > 0) {
                let regionMatch = false;
                for (const region of profile.regions) {
                    if (textToSearch.includes(region.toLowerCase())) {
                        regionMatch = true;
                        break;
                    }
                }
                matches = matches && regionMatch;
            }

            if (matches) {
                await this.dispatchToTier1(payload, profile);
            }
        }
    }

    private static async dispatchToTier1(payload: GeMCollectorPayload, profile: WatchProfile) {
        const signalId = uuidv4();
        const rawSignal = {
            signal_id: signalId,
            source_id: 'gem_xml',
            source_tier: 'TIER_1',
            collected_at: new Date().toISOString(),
            company_name_raw: payload.buyer_name,
            company_name_clean: payload.buyer_name, // Should be resolved further down
            geo_state: payload.ministry_state,
            sector_inferred: payload.item_category,
            signal_strength_I0: 0.95, // High strength for explicit tenders
            lambda: 0.1,
            raw_payload: payload,
            pii_safe: true,
            geo_market: 'IN',
            // Custom field to pass watch profile info
            watch_profile_id: profile.profile_id,
            org_id: profile.org_id
        };

        await tier1Queue.add('process_signal', {
            signal: rawSignal,
            is_triangulated: false,
            // Override the default org behavior by specifying the matched org
            organizationId: profile.org_id
        });

        console.log(`[WatchMatcher] Matched tender ${payload.bid_id} to profile ${profile.profile_id}. Dispatched to Tier 1.`);
    }
}

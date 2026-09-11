import { formatSignalForGemini } from '../signal-formatter';

describe('Signal Formatter Compiler Agent', () => {
    describe('IndiaMART Signal Formatter', () => {
        it('should format IndiaMART payload with quantity, budget, urgency, and engagement', () => {
            const payload = {
                query_message: 'Need 500 pcs urgent delivery for industrial pump',
                query_product_name: 'Water Pumps',
                sender_city: 'Mumbai',
                sender_state: 'Maharashtra',
                query_time: '2026-07-22T10:00:00Z',
                call_duration: '45'
            };

            const result = formatSignalForGemini('indiamart', payload);

            expect(result).toContain('BUYER SAID: "Need 500 pcs urgent delivery for industrial pump"');
            expect(result).toContain('QUANTITY MENTIONED: 500 pcs');
            expect(result).toContain('TIMELINE: URGENT (explicit)');
            expect(result).toContain('PRODUCT CATEGORY: Water Pumps');
            expect(result).toContain('BUYER LOCATION: Mumbai, Maharashtra');
            expect(result).toContain('ENGAGEMENT: Buyer called before posting (45s) — high intent');
        });

        it('should extract budget signals in INR/Lakh/Crore format', () => {
            const payload = {
                query_message: 'Looking for HDPE pipes budget rs 10 lakh',
                PRODUCT_CATEGORY: 'Pipes',
                CITY: 'Delhi',
                STATE: 'Delhi'
            };

            const result = formatSignalForGemini('indiamart', payload);
            expect(result).toContain('BUDGET SIGNAL: rs 10 lakh');
        });
    });


    describe('GeM Tender Signal Formatter', () => {
        it('should format GeM tender details with days remaining and MSME flag', () => {
            const tomorrow = new Date(Date.now() + 86400000 * 2).toISOString();
            const payload = {
                bid_id: 'GEM/2026/B/998877',
                item_category: 'Laptops',
                ministry_dept: 'Ministry of Defence',
                estimated_value_inr: 5000000,
                bid_deadline: tomorrow,
                location_state: 'Karnataka',
                is_msme_reserved: true,
                quantity: 100,
                unit: 'nos'
            };

            const result = formatSignalForGemini('gem', payload);

            expect(result).toContain('TENDER ID: GEM/2026/B/998877');
            expect(result).toContain('CATEGORY: Laptops');
            expect(result).toContain('MINISTRY/DEPT: Ministry of Defence');
            expect(result).toContain('ESTIMATED VALUE: ₹50.0 L');
            expect(result).toContain('CRITICAL: Less than 3 days to deadline');
            expect(result).toContain('MSME RESERVED: Yes — EMD waiver applicable');
            expect(result).toContain('QUANTITY: 100 nos');
        });
    });

    describe('MCA Corporate Filing Signal Formatter', () => {
        it('should format MCA capital increase and director changes', () => {
            const payload = {
                event_type: 'Capital Expansion',
                cin: 'U72200MH2020PTC123456',
                paid_up_capital_before: 1000000,
                paid_up_capital_after: 5000000,
                new_director_name: 'Rajesh Sharma',
                new_director_din: '01234567',
                event_date: '2026-07-20',
                state: 'Maharashtra'
            };

            const result = formatSignalForGemini('mca', payload);

            expect(result).toContain('EVENT: Capital Expansion');
            expect(result).toContain('CIN: U72200MH2020PTC123456');
            expect(result).toContain('CAPITAL CHANGE: ₹10.0 L → ₹50.0 L (+400%)');
            expect(result).toContain('NEW DIRECTOR: Rajesh Sharma (DIN: 01234567)');
        });
    });

    describe('Naukri Hiring Signal Formatter', () => {
        it('should format job posting and extract procurement intent sentences from JD', () => {
            const payload = {
                job_title: 'Head of Procurement',
                company_name: 'Apex Manufacturing',
                job_location: 'Bengaluru',
                posted_date: '2026-07-21T00:00:00Z',
                salary_range: '30-40 LPA',
                job_description: 'We are seeking an expert to manage vendor relationships and source raw materials for our new plant.'
            };

            const result = formatSignalForGemini('naukri', payload);

            expect(result).toContain('JOB TITLE: Head of Procurement');
            expect(result).toContain('COMPANY: Apex Manufacturing');
            expect(result).toContain('LOCATION: Bengaluru');
            expect(result).toContain('SALARY RANGE: 30-40 LPA');
            expect(result).toContain('KEY JD EXCERPTS:');
            expect(result).toContain('manage vendor relationships');
        });
    });

    describe('Zauba Import & Funding Signal Formatters', () => {
        it('should format Zauba import shipment data', () => {
            const payload = {
                company_name: 'TechImports Pvt Ltd',
                import_item: 'Semiconductors',
                import_value: '15000000',
                port_of_entry: 'Nhava Sheva'
            };

            const result = formatSignalForGemini('zauba', payload);

            expect(result).toContain('IMPORTER: TechImports Pvt Ltd');
            expect(result).toContain('PRODUCT: Semiconductors');
            expect(result).toContain('SHIPMENT VALUE: ₹1.5 Cr');
            expect(result).toContain('PORT: Nhava Sheva');
        });

        it('should format startup funding events', () => {
            const payload = {
                company_name: 'FastScale AI',
                funding_round: 'Series A',
                funding_amount: '$5M',
                use_of_funds: 'Expanding sales team and tech stack'
            };

            const result = formatSignalForGemini('funding', payload);

            expect(result).toContain('COMPANY: FastScale AI');
            expect(result).toContain('ROUND: Series A');
            expect(result).toContain('AMOUNT: $5M');
            expect(result).toContain('USE OF FUNDS STATED: "Expanding sales team and tech stack"');
        });
    });

    describe('Generic Fallback Formatter', () => {
        it('should fallback to generic key-value string extractor for unknown source IDs', () => {
            const payload = {
                supplier_code: 'SUPP-99',
                lead_score: 92,
                region_market: 'Middle East'
            };

            const result = formatSignalForGemini('unknown_source', payload);

            expect(result).toContain('SUPPLIER_CODE: SUPP-99');
            expect(result).toContain('REGION_MARKET: Middle East');
        });
    });
});

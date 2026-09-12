import {
    InstaClient,
    getInstaClient,
    resolveStateCode,
    PAN_INDIA_GST_SENTINEL,
    SANDBOX_APPROVED_TEST_CIN
} from '../insta-client';
import { cache } from '../../../lib/cache';
import axios from 'axios';

jest.mock('../../../lib/cache', () => ({
    cache: {
        get: jest.fn().mockResolvedValue(null),
        set: jest.fn().mockResolvedValue('OK')
    }
}));

jest.mock('../../../lib/database', () => ({
    query: jest.fn().mockResolvedValue({ rows: [] })
}));

describe('InstaClient API Implementation & Current Documentation Alignment', () => {
    let client: InstaClient;

    beforeEach(() => {
        jest.clearAllMocks();
        client = new InstaClient('test-api-key-12345', 'https://api.instafinancials.com');
    });

    describe('1. Configuration & Base URL', () => {
        test('Normalizes base URL stripping trailing /InstaReports/v1 or v2', () => {
            const clientWithV1 = new InstaClient('key', 'https://api.instafinancials.com/InstaReports/v1');
            expect((clientWithV1 as any).client.defaults.baseURL).toBe('https://api.instafinancials.com');

            const clientWithV2 = new InstaClient('key', 'https://api.instafinancials.com/InstaReports/v2/');
            expect((clientWithV2 as any).client.defaults.baseURL).toBe('https://api.instafinancials.com');
        });

        test('Includes user-key header and accepts JSON', () => {
            const headers = (client as any).client.defaults.headers;
            expect(headers['user-key']).toBe('test-api-key-12345');
            expect(headers['Accept']).toBe('application/json');
        });

        test('Provides sandbox approved test CIN for Indian Oil Corporation', () => {
            expect(SANDBOX_APPROVED_TEST_CIN).toBe('L23201MH1959GOI011388');
        });
    });

    describe('2. GetCIN (v1 GET)', () => {
        test('Calls GET /InstaReports/v1/GetCIN/Search/{term}/Mode/{mode}', async () => {
            const mockGet = jest.spyOn((client as any).client, 'get').mockResolvedValueOnce({
                data: [
                    {
                        CompanyCIN: 'L23201MH1959GOI011388',
                        CompanyName: 'INDIAN OIL CORPORATION LIMITED',
                        CompanyStatus: 'ACTIVE'
                    }
                ]
            });

            const results = await client.searchCIN('INDIAN OIL', 'SW');

            expect(mockGet).toHaveBeenCalledWith(
                '/InstaReports/v1/GetCIN/Search/INDIAN%20OIL/Mode/SW'
            );
            expect(results.length).toBe(1);
            expect(results[0].CompanyCIN).toBe('L23201MH1959GOI011388');
        });
    });

    describe('3. InstaBasic (v2 GET with daysToIgnore=999)', () => {
        test('Calls GET /InstaReports/v2/InstaBasic/CompanyCIN/{cin}?daysToIgnore=999 synchronously', async () => {
            const mockBasicPayload = {
                CompanyCIN: 'L23201MH1959GOI011388',
                CompanyName: 'INDIAN OIL CORPORATION LIMITED',
                CompanyStatus: 'ACTIVE',
                PAN: 'AAACI1681G',
                DateOfIncorporation: '1959-06-30',
                AuthorizedCapital: 150000000000,
                PaidUpCapital: 141212390000,
                RegisteredAddress: 'G-9, Ali Yavar Jung Marg, Bandra (East), Mumbai',
                State: 'Maharashtra',
                Pincode: '400051',
                Directors: [
                    {
                        DIN: '00012345',
                        DirectorName: 'Vaidya Shrikant Madhav',
                        Designation: 'Chairman',
                        DateOfAppointment: '2020-07-01'
                    }
                ],
                Charges: [
                    {
                        ChargeID: 'CHG1001',
                        ChargeHolder: 'State Bank of India',
                        Amount: 5000000000,
                        DateOfCreation: '2015-03-12',
                        Status: 'Active'
                    }
                ]
            };

            const mockGet = jest.spyOn((client as any).client, 'get').mockResolvedValueOnce({
                data: mockBasicPayload
            });

            const report = await client.fetchInstaBasic('L23201MH1959GOI011388', 999);

            expect(mockGet).toHaveBeenCalledWith(
                '/InstaReports/v2/InstaBasic/CompanyCIN/L23201MH1959GOI011388?daysToIgnore=999'
            );
            expect(report).toBeDefined();
            expect(report?.CompanyName).toBe('INDIAN OIL CORPORATION LIMITED');
            expect(report?.PAN).toBe('AAACI1681G');
            expect(report?.Directors?.length).toBe(1);
            expect(report?.Charges?.length).toBe(1);
            expect(cache.set).toHaveBeenCalledWith(
                'insta:basic:L23201MH1959GOI011388',
                mockBasicPayload,
                expect.objectContaining({ ex: 30 * 24 * 3600 })
            );
        });
    });

    describe('4. BRiskFinancials with Ownership Details (v1 POST Async)', () => {
        test('Orders BRiskFinancials with ["FIN","OD"] body and polls until complete', async () => {
            const mockPost = jest.spyOn((client as any).client, 'post').mockResolvedValueOnce({
                data: {
                    OrderID: 987654,
                    OrderStatus: 'Pending',
                    IsBillable: true
                }
            });

            const mockGetStatus = jest.spyOn((client as any).client, 'get')
                .mockResolvedValueOnce({
                    data: {
                        OrderID: 987654,
                        OrderStatus: 'Completed',
                        IsCompleted: true
                    }
                })
                .mockResolvedValueOnce({
                    data: {
                        CompanyCIN: 'L23201MH1959GOI011388',
                        Subsidiaries: [
                            { CIN: 'U11100DL1999GOI100001', CompanyName: 'INDIAN OIL LIQUIFIED GAS' }
                        ],
                        HoldingCompany: {
                            CIN: 'GOI_MINISTRY',
                            CompanyName: 'President of India / Ministry of Petroleum'
                        }
                    }
                });

            const report = await client.fetchBRiskFinancials('L23201MH1959GOI011388');

            expect(mockPost).toHaveBeenCalledWith(
                '/InstaReports/v1/BRiskFinancials/CompanyCIN/L23201MH1959GOI011388/OrderReport',
                ['FIN', 'OD']
            );
            expect(report).toBeDefined();
            expect(report?.Subsidiaries?.length).toBe(1);
            expect(report?.HoldingCompany?.CompanyName).toBe('President of India / Ministry of Petroleum');
        });

        test('fetchInstaDetailed serves as backward-compatible alias to fetchBRiskFinancials', async () => {
            const spy = jest.spyOn(client, 'fetchBRiskFinancials').mockResolvedValueOnce({
                CompanyCIN: 'L23201MH1959GOI011388',
                Subsidiaries: []
            });

            const res = await client.fetchInstaDetailed('L23201MH1959GOI011388');
            expect(spy).toHaveBeenCalledWith('L23201MH1959GOI011388');
            expect(res?.CompanyCIN).toBe('L23201MH1959GOI011388');
        });
    });

    describe('5. Full Enrichment Lifecycle', () => {
        test('Combines InstaBasic v2 (directors/charges) and BRiskFinancials (ownership)', async () => {
            jest.spyOn(client, 'fetchInstaBasic').mockResolvedValueOnce({
                CompanyCIN: 'L23201MH1959GOI011388',
                CompanyName: 'INDIAN OIL CORPORATION LIMITED',
                CompanyStatus: 'ACTIVE',
                PAN: 'AAACI1681G',
                DateOfIncorporation: '1959-06-30',
                AuthorizedCapital: 150000000000,
                PaidUpCapital: 141212390000,
                State: 'Maharashtra',
                Directors: [
                    { DIN: '00012345', DirectorName: 'Vaidya Shrikant Madhav', Designation: 'Chairman' }
                ],
                Charges: [
                    { ChargeID: 'C1', ChargeHolder: 'SBI', Amount: 1000000, Status: 'Active' }
                ]
            });

            jest.spyOn(client, 'fetchBRiskFinancials').mockResolvedValueOnce({
                CompanyCIN: 'L23201MH1959GOI011388',
                Subsidiaries: [
                    { CIN: 'U11100DL1999GOI100001', CompanyName: 'IndianOil LNG Private Limited' }
                ]
            });

            jest.spyOn(client, 'writeCanonicalEntity').mockResolvedValue(true);

            const entity = await client.runEnrichmentLifecycle('L23201MH1959GOI011388', {
                enrichTiers: ['BASIC', 'DETAILED']
            });

            expect(entity.canonicalName).toBe('INDIAN OIL CORPORATION LIMITED');
            expect(entity.cin).toBe('L23201MH1959GOI011388');
            expect(entity.pan).toBe('AAACI1681G');
            expect(entity.companyStatus).toBe('ACTIVE');
            expect(entity.directors.length).toBe(1);
            expect(entity.charges.length).toBe(1);
            expect(entity.groupHierarchy.subsidiaries?.length).toBe(1);
            expect(entity.groupHierarchy.subsidiaries?.[0].name).toBe('IndianOil LNG Private Limited');
        });
    });
});

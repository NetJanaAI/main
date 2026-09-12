import { CsvIngestionService } from '../csv-ingestion-service';

// Mock database query to avoid requiring live Postgres in unit tests
jest.mock('../../../lib/database', () => ({
    query: jest.fn(async (sql: string, params: any[]) => {
        if (sql.includes('SELECT entity_id FROM canonical_entity_cache')) {
            // Return found for existing test CIN
            if (params && params.includes('L22210MH1995PLC084781')) {
                return { rows: [{ entity_id: 'L22210MH1995PLC084781' }] };
            }
            return { rows: [] };
        }
        if (sql.includes('INSERT INTO canonical_entity_cache')) {
            return { rows: [{ entity_id: params[0] }] };
        }
        if (sql.includes('INSERT INTO org_registry')) {
            return { rows: [{ org_id: params[0] }] };
        }
        if (sql.includes('INSERT INTO graph_nodes')) {
            return { rows: [{ id: 'node_1' }] };
        }
        if (sql.includes('INSERT INTO graph_edges')) {
            return { rows: [{ id: 'edge_1' }] };
        }
        if (sql.includes('UPDATE canonical_entity_cache')) {
            return { rows: [] };
        }
        return { rows: [] };
    }),
}));

describe('CsvIngestionService', () => {

    describe('previewCsv', () => {
        it('parses company CSV headers and auto-suggests company field mappings', () => {
            const csv = `Company Name,CIN,Registered State,Sector,Address
"Tata Consultancy Services Limited","L22210MH1995PLC084781","Maharashtra","Information Technology","Mumbai"
"Infosys Limited","L85110KA1981PLC013115","Karnataka","Software","Bengaluru"`;

            const preview = CsvIngestionService.previewCsv(csv);
            expect(preview.headers).toEqual(['Company Name', 'CIN', 'Registered State', 'Sector', 'Address']);
            expect(preview.sampleRows).toHaveLength(2);
            expect(preview.detectedType).toBe('company');
            expect(preview.suggestedMapping).toEqual(expect.objectContaining({
                'Company Name': 'canonicalName',
                'CIN': 'cin',
                'Registered State': 'registeredState',
                'Sector': 'sector',
                'Address': 'registeredAddress',
            }));
        });

        it('parses employee CSV headers and auto-suggests employee field mappings', () => {
            const csv = `Employee Name,Designation,Department,Email,Phone,Company Name
"Rajesh Gopinathan","Managing Director & CEO","Leadership","rajesh.g@tcs.com","+91-9820011223","Tata Consultancy Services Limited"`;

            const preview = CsvIngestionService.previewCsv(csv);
            expect(preview.headers).toEqual(['Employee Name', 'Designation', 'Department', 'Email', 'Phone', 'Company Name']);
            expect(preview.detectedType).toBe('employee');
            expect(preview.suggestedMapping).toEqual(expect.objectContaining({
                'Employee Name': 'name',
                'Designation': 'designation',
                'Department': 'department',
                'Email': 'email',
                'Company Name': 'companyName',
            }));
        });

        it('throws an error for empty CSV', () => {
            expect(() => CsvIngestionService.previewCsv('')).toThrow('CSV file is empty');
        });
    });

    describe('ingestCsv', () => {
        it('processes company records and returns report', async () => {
            const csv = `Company Name,CIN,State,Sector
"Tata Consultancy Services Limited","L22210MH1995PLC084781","Maharashtra","IT"
"Infosys Limited","L85110KA1981PLC013115","Karnataka","Software"`;

            const report = await CsvIngestionService.ingestCsv(csv, {
                type: 'company',
                mapping: {
                    'Company Name': 'canonicalName',
                    'CIN': 'cin',
                    'State': 'registeredState',
                    'Sector': 'sector'
                }
            });

            expect(report.totalRows).toBe(2);
            expect(report.successCount).toBe(2);
            expect(report.errorCount).toBe(0);
        });

        it('processes employee records and links to company', async () => {
            const csv = `Employee Name,Designation,Email,Company Name,CIN
"Rajesh Gopinathan","Managing Director & CEO","rajesh.g@tcs.com","Tata Consultancy Services Limited","L22210MH1995PLC084781"`;

            const report = await CsvIngestionService.ingestCsv(csv, {
                type: 'employee',
                mapping: {
                    'Employee Name': 'name',
                    'Designation': 'designation',
                    'Email': 'email',
                    'Company Name': 'companyName',
                    'CIN': 'cin'
                }
            });

            expect(report.totalRows).toBe(1);
            expect(report.successCount).toBe(1);
            expect(report.linkedEmployeesCount).toBe(1);
        });

        it('records row-level errors for records with missing required fields', async () => {
            const csv = `Company Name,CIN
"",""`;

            const report = await CsvIngestionService.ingestCsv(csv, {
                type: 'company',
                mapping: {
                    'Company Name': 'canonicalName',
                    'CIN': 'cin'
                }
            });

            expect(report.errorCount).toBe(1);
            expect(report.errors[0].row).toBe(2);
            expect(report.errors[0].error).toContain('Missing company name');
        });
    });

    describe('getSampleCsvTemplate', () => {
        it('returns sample CSV for company, employee, and unified', () => {
            const companyCsv = CsvIngestionService.getSampleCsvTemplate('company');
            expect(companyCsv).toContain('Company Name');
            expect(companyCsv).toContain('CIN');

            const employeeCsv = CsvIngestionService.getSampleCsvTemplate('employee');
            expect(employeeCsv).toContain('Employee Name');
            expect(employeeCsv).toContain('Designation');

            const unifiedCsv = CsvIngestionService.getSampleCsvTemplate('unified');
            expect(unifiedCsv).toContain('Company Name');
            expect(unifiedCsv).toContain('Employee Name');
        });
    });
});

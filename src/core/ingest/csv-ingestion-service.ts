import { parse } from 'csv-parse/sync';
import crypto from 'crypto';
import { query } from '../../lib/database';
import { EmployeeContact } from '../entity-resolution/types';
import { TenantRAGStore } from '../rag/TenantRAGStore';

export interface ColumnMapping {
    [csvHeader: string]: string; // csvHeader -> platformField
}

export interface IngestOptions {
    orgId?: string;
    indexVector?: boolean;
    type: 'company' | 'employee' | 'unified';
    mapping?: ColumnMapping;
}

export interface CsvPreviewResult {
    headers: string[];
    sampleRows: Record<string, string>[];
    totalRowsEstimate: number;
    suggestedMapping: Record<string, string>;
    detectedType: 'company' | 'employee' | 'unified';
}

export interface IngestReport {
    totalRows: number;
    successCount: number;
    errorCount: number;
    updatedCount: number;
    createdCount: number;
    linkedEmployeesCount?: number;
    errors: Array<{ row: number; error: string; data?: any }>;
    durationMs: number;
}

// Field synonyms for auto-mapping
const COMPANY_FIELD_SYNONYMS: Record<string, string[]> = {
    canonicalName: ['company', 'company_name', 'companyname', 'organization', 'organisation', 'entity', 'business_name', 'client', 'name', 'legal_name'],
    cin: ['cin', 'corporate_id', 'company_id', 'cin_number', 'mca_cin', 'registration_number', 'reg_no'],
    pan: ['pan', 'pan_number', 'tax_id', 'company_pan'],
    registeredState: ['state', 'registered_state', 'geo_state', 'location', 'region', 'province'],
    sector: ['sector', 'industry', 'category', 'nic_description', 'nic', 'business_type', 'domain'],
    authorizedCapital: ['authorized_capital', 'auth_capital', 'capital_authorized', 'capital'],
    paidUpCapital: ['paid_up_capital', 'paidup_capital', 'paid_capital'],
    registeredAddress: ['address', 'registered_address', 'office_address', 'location_address', 'street'],
    website: ['website', 'url', 'web', 'domain', 'link'],
    phone: ['phone', 'contact_number', 'telephone', 'mobile', 'tel']
};

const EMPLOYEE_FIELD_SYNONYMS: Record<string, string[]> = {
    name: ['name', 'full_name', 'employee_name', 'contact_name', 'person', 'executive', 'lead', 'individual'],
    designation: ['designation', 'title', 'job_title', 'role', 'position', 'seniority'],
    department: ['department', 'dept', 'function', 'team', 'division'],
    email: ['email', 'work_email', 'contact_email', 'e_mail', 'mail'],
    phone: ['phone', 'mobile', 'cell', 'telephone', 'contact_no', 'phone_number'],
    linkedinUrl: ['linkedin', 'linkedin_url', 'linkedin_profile', 'social', 'profile'],
    companyName: ['company', 'company_name', 'employer', 'organization', 'organisation', 'works_at'],
    cin: ['cin', 'company_cin', 'employer_cin']
};

export class CsvIngestionService {

    /**
     * Inspect uploaded CSV content, extract headers, first 5 rows, and suggest column mappings.
     */
    static previewCsv(csvContent: string): CsvPreviewResult {
        if (!csvContent || !csvContent.trim()) {
            throw new Error('CSV file is empty');
        }

        const records: Record<string, string>[] = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_quotes: true,
            relax_column_count: true,
            to: 100 // parse first 100 to estimate
        });

        if (records.length === 0) {
            throw new Error('No tabular rows detected in CSV file');
        }

        const headers = Object.keys(records[0]);
        const sampleRows = records.slice(0, 5);

        // Detect type based on header matches
        let employeeScore = 0;
        let companyScore = 0;

        const normalizedHeaders = headers.map(h => h.toLowerCase().replace(/[^a-z0-9]/g, '_'));

        for (const h of normalizedHeaders) {
            if (['email', 'designation', 'title', 'employee_name', 'linkedin', 'department'].some(term => h.includes(term))) {
                employeeScore += 2;
            }
            if (['cin', 'authorized_capital', 'paid_up_capital', 'company_status', 'nic'].some(term => h.includes(term))) {
                companyScore += 2;
            }
        }

        let detectedType: 'company' | 'employee' | 'unified' = 'company';
        if (employeeScore > companyScore && employeeScore >= 2) {
            detectedType = (companyScore >= 2) ? 'unified' : 'employee';
        }

        // Build suggested mappings
        const suggestedMapping: Record<string, string> = {};
        const synonymDict = (detectedType === 'employee') 
            ? EMPLOYEE_FIELD_SYNONYMS 
            : (detectedType === 'unified') 
                ? { ...COMPANY_FIELD_SYNONYMS, ...EMPLOYEE_FIELD_SYNONYMS } 
                : COMPANY_FIELD_SYNONYMS;

        for (const rawHeader of headers) {
            const clean = rawHeader.toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/^_+|_+$/g, '');
            for (const [field, synonyms] of Object.entries(synonymDict)) {
                if (clean === field.toLowerCase() || synonyms.includes(clean)) {
                    suggestedMapping[rawHeader] = field;
                    break;
                }
            }
        }

        // Quick line count estimation
        const totalRowsEstimate = (csvContent.match(/\r\n|\r|\n/g)?.length || 1) - 1;

        return {
            headers,
            sampleRows,
            totalRowsEstimate: Math.max(totalRowsEstimate, records.length),
            suggestedMapping,
            detectedType
        };
    }

    /**
     * Process and ingest CSV records based on confirmed column mappings and options.
     */
    static async ingestCsv(csvContent: string, options: IngestOptions): Promise<IngestReport> {
        const start = Date.now();
        const records: Record<string, string>[] = parse(csvContent, {
            columns: true,
            skip_empty_lines: true,
            trim: true,
            relax_quotes: true,
            relax_column_count: true
        });

        const mapping = options.mapping || {};
        const orgId = options.orgId || 'default';
        const errors: Array<{ row: number; error: string; data?: any }> = [];

        let successCount = 0;
        let createdCount = 0;
        let updatedCount = 0;
        let linkedEmployeesCount = 0;

        const ragDocsToIndex: Array<{ content: string; chunkIndex: number; contentHash: string; metadata: any }> = [];

        for (let i = 0; i < records.length; i++) {
            const rowNum = i + 2; // +1 for 0-index, +1 for header line
            const rawRow = records[i];

            // Apply mapping
            const mappedRow: Record<string, string> = {};
            for (const [csvKey, val] of Object.entries(rawRow)) {
                const targetKey = mapping[csvKey] || csvKey;
                mappedRow[targetKey] = (val || '').trim();
            }

            try {
                if (options.type === 'company') {
                    const res = await this.ingestCompanyRecord(mappedRow, orgId);
                    if (res.isNew) createdCount++;
                    else updatedCount++;
                    successCount++;

                    if (options.indexVector) {
                        const content = `[COMPANY DIRECTORY: ${mappedRow.canonicalName}]
CIN: ${mappedRow.cin || 'N/A'} | PAN: ${mappedRow.pan || 'N/A'}
State: ${mappedRow.registeredState || 'N/A'} | Sector: ${mappedRow.sector || 'N/A'}
Address: ${mappedRow.registeredAddress || 'N/A'}
Website: ${mappedRow.website || 'N/A'} | Phone: ${mappedRow.phone || 'N/A'}`;
                        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
                        ragDocsToIndex.push({
                            content,
                            chunkIndex: ragDocsToIndex.length,
                            contentHash,
                            metadata: {
                                doc_type: 'company_csv',
                                entity_id: res.entityId,
                                company_name: mappedRow.canonicalName,
                                cin: mappedRow.cin,
                                org_id: orgId
                            }
                        });
                    }
                } else if (options.type === 'employee') {
                    const res = await this.ingestEmployeeRecord(mappedRow, orgId);
                    if (res.createdCompany) createdCount++;
                    linkedEmployeesCount++;
                    successCount++;

                    if (options.indexVector) {
                        const content = `[EXECUTIVE CONTACT: ${mappedRow.name}]
Title: ${mappedRow.designation || 'N/A'} | Dept: ${mappedRow.department || 'N/A'}
Company: ${mappedRow.companyName || 'N/A'} (CIN: ${mappedRow.cin || 'N/A'})
Email: ${mappedRow.email || 'N/A'} | Phone: ${mappedRow.phone || 'N/A'}
LinkedIn: ${mappedRow.linkedinUrl || 'N/A'}`;
                        const contentHash = crypto.createHash('sha256').update(content).digest('hex');
                        ragDocsToIndex.push({
                            content,
                            chunkIndex: ragDocsToIndex.length,
                            contentHash,
                            metadata: {
                                doc_type: 'employee_csv',
                                contact_name: mappedRow.name,
                                company_name: mappedRow.companyName,
                                email: mappedRow.email,
                                org_id: orgId
                            }
                        });
                    }
                } else {
                    // Unified mode: Company + Employee in same row
                    const compRes = await this.ingestCompanyRecord(mappedRow, orgId);
                    if (compRes.isNew) createdCount++;
                    else updatedCount++;

                    if (mappedRow.name || mappedRow.email) {
                        await this.ingestEmployeeRecord({
                            ...mappedRow,
                            companyName: mappedRow.canonicalName || mappedRow.companyName,
                            cin: mappedRow.cin
                        }, orgId);
                        linkedEmployeesCount++;
                    }
                    successCount++;
                }
            } catch (err: any) {
                errors.push({
                    row: rowNum,
                    error: err.message || 'Processing error',
                    data: rawRow
                });
            }
        }

        // Asynchronously index in RAG if requested
        if (options.indexVector && ragDocsToIndex.length > 0) {
            try {
                const ragStore = new TenantRAGStore(orgId);
                await ragStore.upsertBatch(ragDocsToIndex, 'upload', 'csv_ingest');
            } catch (ragErr: any) {
                console.warn('[CsvIngestion] RAG indexing failed:', ragErr.message);
            }
        }

        return {
            totalRows: records.length,
            successCount,
            errorCount: errors.length,
            createdCount,
            updatedCount,
            linkedEmployeesCount,
            errors: errors.slice(0, 50), // cap to top 50 errors for UI
            durationMs: Date.now() - start
        };
    }

    /**
     * Upsert a company into canonical_entity_cache & org_registry.
     */
    private static async ingestCompanyRecord(row: Record<string, string>, orgId: string): Promise<{ entityId: string; isNew: boolean }> {
        const canonicalName = row.canonicalName || row.name || row.company;
        if (!canonicalName) {
            throw new Error('Missing company name in record');
        }

        const cin = row.cin ? row.cin.toUpperCase().replace(/\s+/g, '') : null;
        const pan = row.pan ? row.pan.toUpperCase().replace(/\s+/g, '') : null;
        const state = row.registeredState || row.state || 'UNKNOWN';
        const sector = row.sector || row.nicDescription || null;
        const address = row.registeredAddress || null;
        const authCap = parseFloat(row.authorizedCapital || '0') || null;
        const paidCap = parseFloat(row.paidUpCapital || '0') || null;

        // Deterministic entity ID: CIN if valid, otherwise clean name sha256 hash
        const cleanName = canonicalName.toUpperCase().replace(/[^A-Z0-9]/g, '');
        const entityId = cin || `COMP_${crypto.createHash('sha256').update(cleanName).digest('hex').slice(0, 16)}`;

        // Check if existing
        const existing = await query(
            'SELECT entity_id FROM canonical_entity_cache WHERE entity_id = $1 OR (cin IS NOT NULL AND cin = $2) LIMIT 1',
            [entityId, cin]
        );

        const isNew = existing.rows.length === 0;

        await query(
            `INSERT INTO canonical_entity_cache (
                entity_id, canonical_name, cin, pan, registered_state, nic_description,
                registered_address, authorized_capital, paid_up_capital, resolution_method,
                company_status, enrichment_status, updated_at
            ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'CSV_INGEST', 'ACTIVE', 'COMPLETED', NOW())
            ON CONFLICT (entity_id) DO UPDATE SET
                canonical_name = COALESCE(canonical_entity_cache.canonical_name, EXCLUDED.canonical_name),
                cin = COALESCE(canonical_entity_cache.cin, EXCLUDED.cin),
                pan = COALESCE(canonical_entity_cache.pan, EXCLUDED.pan),
                registered_state = COALESCE(EXCLUDED.registered_state, canonical_entity_cache.registered_state),
                nic_description = COALESCE(EXCLUDED.nic_description, canonical_entity_cache.nic_description),
                registered_address = COALESCE(EXCLUDED.registered_address, canonical_entity_cache.registered_address),
                authorized_capital = COALESCE(EXCLUDED.authorized_capital, canonical_entity_cache.authorized_capital),
                paid_up_capital = COALESCE(EXCLUDED.paid_up_capital, canonical_entity_cache.paid_up_capital),
                updated_at = NOW()`,
            [entityId, canonicalName, cin, pan, state, sector, address, authCap, paidCap]
        );

        // Also sync into org_registry for fast lookup
        await query(
            `INSERT INTO org_registry (
                org_id, canonical_name, geo_state, cin, pan, resolution_method, verity_tier, first_seen, last_signal_at
            ) VALUES ($1, $2, $3, $4, $5, 'CSV_INGEST', 'TIER_1', NOW(), NOW())
            ON CONFLICT (org_id) DO UPDATE SET
                canonical_name = EXCLUDED.canonical_name,
                geo_state = EXCLUDED.geo_state,
                cin = COALESCE(org_registry.cin, EXCLUDED.cin),
                pan = COALESCE(org_registry.pan, EXCLUDED.pan),
                last_signal_at = NOW()`,
            [entityId, canonicalName, state, cin, pan]
        );

        return { entityId, isNew };
    }

    /**
     * Upsert an employee contact and link to employer entity.
     */
    private static async ingestEmployeeRecord(row: Record<string, string>, orgId: string): Promise<{ contactId: string; createdCompany: boolean }> {
        const name = row.name;
        if (!name) {
            throw new Error('Missing employee name');
        }

        const companyName = row.companyName || row.company || 'Unknown Organisation';
        const cin = row.cin ? row.cin.toUpperCase().replace(/\s+/g, '') : null;
        const email = row.email ? row.email.toLowerCase().trim() : undefined;
        const phone = row.phone ? row.phone.trim() : undefined;
        const designation = row.designation || 'Staff / Executive';
        const department = row.department || undefined;
        const linkedinUrl = row.linkedinUrl || undefined;

        // Find or create employer entity
        let entityId: string | null = null;
        let createdCompany = false;

        if (cin) {
            const cinRes = await query('SELECT entity_id FROM canonical_entity_cache WHERE cin = $1 LIMIT 1', [cin]);
            if (cinRes.rows.length > 0) {
                entityId = cinRes.rows[0].entity_id;
            }
        }

        if (!entityId && companyName) {
            const nameRes = await query(
                'SELECT entity_id FROM canonical_entity_cache WHERE UPPER(canonical_name) = UPPER($1) LIMIT 1',
                [companyName]
            );
            if (nameRes.rows.length > 0) {
                entityId = nameRes.rows[0].entity_id;
            } else {
                // Auto-create company stub so the employee has an employer anchor
                const stubRes = await this.ingestCompanyRecord({
                    canonicalName: companyName,
                    cin: cin || '',
                    registeredState: 'IN'
                }, orgId);
                entityId = stubRes.entityId;
                createdCompany = true;
            }
        }

        const contactId = `EMP_${crypto.createHash('sha256').update(`${entityId || 'NA'}_${email || name}_${designation}`).digest('hex').slice(0, 16)}`;

        const contact: EmployeeContact = {
            id: contactId,
            name,
            designation,
            department,
            email,
            phone,
            linkedinUrl,
            companyName,
            cin: cin || undefined,
            source: 'CSV_INGEST',
            createdAt: new Date().toISOString()
        };

        if (entityId) {
            // Append or update in canonical_entity_cache.employees JSONB array
            await query(
                `UPDATE canonical_entity_cache
                 SET employees = (
                     SELECT jsonb_agg(DISTINCT elem)
                     FROM (
                         SELECT elem FROM jsonb_array_elements(COALESCE(employees, '[]'::jsonb)) elem
                         WHERE elem->>'email' IS DISTINCT FROM $2 AND elem->>'id' IS DISTINCT FROM $3
                         UNION ALL
                         SELECT $1::jsonb
                     ) s
                 ),
                 updated_at = NOW()
                 WHERE entity_id = $4`,
                [JSON.stringify(contact), email || '__NO_EMAIL__', contactId, entityId]
            );

            // Also persist as knowledge graph node & edge for organogram visualizer
            try {
                const nodeRes = await query(
                    `INSERT INTO graph_nodes (type, label, data, organization_id)
                     VALUES ('EMPLOYEE', $1, $2, (SELECT id FROM tenants WHERE name = 'Default Organization' LIMIT 1))
                     ON CONFLICT (type, label, organization_id) DO UPDATE SET data = EXCLUDED.data
                     RETURNING id`,
                    [name, JSON.stringify(contact)]
                );

                const compNodeRes = await query(
                    `INSERT INTO graph_nodes (type, label, data, organization_id)
                     VALUES ('ORG', $1, $2, (SELECT id FROM tenants WHERE name = 'Default Organization' LIMIT 1))
                     ON CONFLICT (type, label, organization_id) DO NOTHING
                     RETURNING id`,
                    [companyName, JSON.stringify({ entityId, cin })]
                );

                const employeeNodeId = nodeRes.rows[0]?.id;
                let orgNodeId = compNodeRes.rows[0]?.id;

                if (!orgNodeId) {
                    const existingNode = await query(
                        `SELECT id FROM graph_nodes WHERE type = 'ORG' AND label = $1 LIMIT 1`,
                        [companyName]
                    );
                    orgNodeId = existingNode.rows[0]?.id;
                }

                if (employeeNodeId && orgNodeId) {
                    await query(
                        `INSERT INTO graph_edges (from_id, to_id, type, data, organization_id)
                         VALUES ($1, $2, 'EMPLOYED_AT', $3, (SELECT id FROM tenants WHERE name = 'Default Organization' LIMIT 1))
                         ON CONFLICT (from_id, to_id, type, organization_id) DO UPDATE SET data = EXCLUDED.data`,
                        [employeeNodeId, orgNodeId, JSON.stringify({ designation, department })]
                    );
                }
            } catch (graphErr: any) {
                console.warn('[CsvIngestion] Graph node link skipped:', graphErr.message);
            }
        }

        return { contactId, createdCompany };
    }

    /**
     * Provide ready-to-download sample CSV templates for the user.
     */
    static getSampleCsvTemplate(type: 'company' | 'employee' | 'unified'): string {
        if (type === 'company') {
            return `Company Name,CIN,PAN,Registered State,Sector,Authorized Capital,Paid Up Capital,Address,Website,Phone
"Tata Consultancy Services Limited","L22210MH1995PLC084781","AAACT2727Q","Maharashtra","Information Technology",4000000000,3659054790,"Nirmal Building, 9th Floor, Nariman Point, Mumbai - 400021","https://www.tcs.com","+91-22-67789999"
"Infosys Limited","L85110KA1981PLC013115","AAACI4747K","Karnataka","Software & Cloud Solutions",2400000000,2071300000,"Electronics City, Hosur Road, Bengaluru - 560100","https://www.infosys.com","+91-80-28520261"
"Indian Oil Corporation Limited","L23201MH1959GOI011388","AAACI1681G","Maharashtra","Refining & Petrochemicals",15000000000,14121239000,"Indian Oil Bhavan, G-9, Ali Yavar Jung Marg, Bandra East, Mumbai - 400051","https://iocl.com","+91-22-26447616"`;
        }

        if (type === 'employee') {
            return `Employee Name,Designation,Department,Email,Phone,Company Name,CIN,LinkedIn URL
"Rajesh Gopinathan","Managing Director & CEO","Leadership","rajesh.g@tcs.com","+91-9820011223","Tata Consultancy Services Limited","L22210MH1995PLC084781","https://linkedin.com/in/rajesh-gopinathan"
"Salil Parekh","Chief Executive Officer","Executive","salil.parekh@infosys.com","+91-9845012345","Infosys Limited","L85110KA1981PLC013115","https://linkedin.com/in/salil-parekh"
"Anand Vardhan","Head of Procurement","Procurement","anand.v@iocl.com","+91-9920199882","Indian Oil Corporation Limited","L23201MH1959GOI011388","https://linkedin.com/in/anand-vardhan"
"Priya Sharma","VP Enterprise Sales","Sales","priya.sharma@tcs.com","+91-9810055443","Tata Consultancy Services Limited","L22210MH1995PLC084781","https://linkedin.com/in/priya-sharma-sales"`;
        }

        return `Company Name,CIN,Registered State,Sector,Employee Name,Designation,Email,Phone
"Tata Consultancy Services Limited","L22210MH1995PLC084781","Maharashtra","IT Services","Rajesh Gopinathan","Managing Director & CEO","rajesh.g@tcs.com","+91-9820011223"
"Infosys Limited","L85110KA1981PLC013115","Karnataka","IT Services","Salil Parekh","CEO","salil.parekh@infosys.com","+91-9845012345"
"Indian Oil Corporation Limited","L23201MH1959GOI011388","Maharashtra","Energy","Anand Vardhan","Head of Procurement","anand.v@iocl.com","+91-9920199882"`;
    }
}

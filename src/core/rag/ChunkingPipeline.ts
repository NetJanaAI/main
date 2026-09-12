import { createHash } from 'crypto';
import { CanonicalEntity } from '../entity-resolution/types';

export interface TextChunk {
    content: string;
    section: string;
    chunkIndex: number;
    contentHash: string;
    metadata: Record<string, any>;
}

export class ChunkingPipeline {
    /**
     * Estimates token count (approx 4 chars per token).
     */
    static estimateTokens(text: string): number {
        return Math.ceil(text.length / 4);
    }

    /**
     * Generates a deterministic SHA-256 hash for content deduplication.
     */
    static hashContent(text: string): string {
        return createHash('sha256').update(text.trim()).digest('hex');
    }

    /**
     * Sliding window text chunking with token limit and overlap.
     */
    static chunkText(
        text: string,
        maxTokens: number = 512,
        overlapTokens: number = 50
    ): string[] {
        if (!text || !text.trim()) return [];

        const maxChars = maxTokens * 4;
        const overlapChars = overlapTokens * 4;

        // Split by paragraphs first
        const paragraphs = text.split(/\n\s*\n/);
        const chunks: string[] = [];
        let currentChunk = '';

        for (const para of paragraphs) {
            const cleanPara = para.trim();
            if (!cleanPara) continue;

            if (currentChunk.length + cleanPara.length + 2 <= maxChars) {
                currentChunk += (currentChunk ? '\n\n' : '') + cleanPara;
            } else {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    // Create overlap from the tail of currentChunk
                    const overlap = currentChunk.slice(-overlapChars);
                    currentChunk = overlap + '\n\n' + cleanPara;
                } else {
                    // Paragraph itself exceeds maxChars; split by sentence or fixed width
                    let remaining = cleanPara;
                    while (remaining.length > 0) {
                        const slice = remaining.slice(0, maxChars);
                        chunks.push(slice.trim());
                        remaining = remaining.slice(maxChars - overlapChars);
                        if (remaining.length <= overlapChars) break;
                    }
                    currentChunk = '';
                }
            }
        }

        if (currentChunk.trim()) {
            chunks.push(currentChunk.trim());
        }

        return chunks.filter(c => c.length > 0);
    }

    /**
     * Chunks a CanonicalEntity into structured, high-signal semantic sections.
     */
    static chunkEntity(entity: CanonicalEntity): TextChunk[] {
        const chunks: TextChunk[] = [];
        let chunkIndex = 0;

        // Section 1: IDENTITY & STATUTORY
        const identityLines = [
            `Company Name: ${entity.canonicalName}`,
            `Status: ${entity.companyStatus}`,
            entity.cin ? `Corporate Identification Number (CIN): ${entity.cin}` : null,
            entity.pan ? `Permanent Account Number (PAN): ${entity.pan}` : null,
            entity.incorporationDate ? `Date of Incorporation: ${entity.incorporationDate}` : null,
            entity.authorizedCapital ? `Authorized Capital: ₹${entity.authorizedCapital.toLocaleString('en-IN')}` : null,
            entity.paidUpCapital ? `Paid-up Capital: ₹${entity.paidUpCapital.toLocaleString('en-IN')}` : null,
            entity.registeredState ? `Registered State: ${entity.registeredState}` : null,
            entity.registeredPincode ? `Pincode: ${entity.registeredPincode}` : null,
            entity.registeredAddress ? `Registered Address: ${entity.registeredAddress}` : null,
            entity.nicCode ? `NIC Code: ${entity.nicCode}` : null,
            entity.nicDescription ? `Industry / Activity: ${entity.nicDescription}` : null,
            `Resolution Method: ${entity.resolutionMethod}`,
            `Enrichment Status: ${entity.enrichmentStatus}`
        ].filter(Boolean);

        const identityText = `[COMPANY IDENTITY & STATUTORY DETAILS]\n${identityLines.join('\n')}`;
        chunks.push({
            content: identityText,
            section: 'IDENTITY',
            chunkIndex: chunkIndex++,
            contentHash: this.hashContent(identityText),
            metadata: {
                entityId: entity.entityId,
                canonicalName: entity.canonicalName,
                cin: entity.cin,
                pan: entity.pan,
                section: 'IDENTITY'
            }
        });

        // Section 2: DIRECTORS & KEY MANAGERIAL PERSONNEL
        if (entity.directors && entity.directors.length > 0) {
            const directorLines = entity.directors.map(d => {
                const parts = [
                    `- ${d.name} (${d.designation || 'Director'})`,
                    d.din ? `DIN: ${d.din}` : null,
                    d.appointedDate ? `Appointed: ${d.appointedDate}` : null,
                    d.cessationDate ? `Ceased: ${d.cessationDate}` : null
                ].filter(Boolean);
                return parts.join(' | ');
            });

            const directorText = `[DIRECTORS & MANAGEMENT - ${entity.canonicalName}]\n` +
                `Total Directors/Signatories: ${entity.directors.length}\n` +
                directorLines.join('\n');

            chunks.push({
                content: directorText,
                section: 'DIRECTORS',
                chunkIndex: chunkIndex++,
                contentHash: this.hashContent(directorText),
                metadata: {
                    entityId: entity.entityId,
                    canonicalName: entity.canonicalName,
                    directorCount: entity.directors.length,
                    section: 'DIRECTORS'
                }
            });
        }

        // Section 3: CHARGES & BORROWINGS
        if (entity.charges && entity.charges.length > 0) {
            const chargeLines = entity.charges.map(c => {
                const parts = [
                    `- Holder: ${c.holderName}`,
                    `Amount: ₹${(c.amount || 0).toLocaleString('en-IN')}`,
                    c.status ? `Status: ${c.status}` : null,
                    c.creationDate ? `Created: ${c.creationDate}` : null,
                    c.chargeId ? `Charge ID: ${c.chargeId}` : null
                ].filter(Boolean);
                return parts.join(' | ');
            });

            const chargeText = `[CHARGES, BORROWINGS & BANKING LIENS - ${entity.canonicalName}]\n` +
                `Total Charges Registered: ${entity.charges.length}\n` +
                chargeLines.join('\n');

            chunks.push({
                content: chargeText,
                section: 'CHARGES',
                chunkIndex: chunkIndex++,
                contentHash: this.hashContent(chargeText),
                metadata: {
                    entityId: entity.entityId,
                    canonicalName: entity.canonicalName,
                    chargeCount: entity.charges.length,
                    section: 'CHARGES'
                }
            });
        }

        // Section 4: GST ESTABLISHMENTS & BRANCHES
        if (entity.establishments && entity.establishments.length > 0) {
            const estLines = entity.establishments.map(est => {
                const parts = [
                    `- GSTIN: ${est.gstin}`,
                    est.tradeName ? `Trade Name: ${est.tradeName}` : null,
                    est.stateName ? `State: ${est.stateName} (${est.stateCode})` : `State Code: ${est.stateCode}`,
                    est.status ? `Status: ${est.status}` : null,
                    est.isPrimary ? `[PRIMARY ESTABLISHMENT]` : null,
                    est.address ? `Address: ${est.address}` : null
                ].filter(Boolean);
                return parts.join(' | ');
            });

            const estText = `[GST ESTABLISHMENTS & BRANCH LOCATIONS - ${entity.canonicalName}]\n` +
                `Active GST Registrations: ${entity.establishments.length}\n` +
                estLines.join('\n');

            chunks.push({
                content: estText,
                section: 'ESTABLISHMENTS',
                chunkIndex: chunkIndex++,
                contentHash: this.hashContent(estText),
                metadata: {
                    entityId: entity.entityId,
                    canonicalName: entity.canonicalName,
                    gstinCount: entity.establishments.length,
                    section: 'ESTABLISHMENTS'
                }
            });
        }

        // Section 5: CORPORATE GROUP & HOLDING HIERARCHY
        const hierarchy = entity.groupHierarchy || {};
        const hasHierarchy = hierarchy.parentCin || hierarchy.ultimateParentCin ||
            (hierarchy.subsidiaries && hierarchy.subsidiaries.length > 0) ||
            (hierarchy.associates && hierarchy.associates.length > 0);

        if (hasHierarchy) {
            const hierLines = [
                hierarchy.parentName ? `Holding Company: ${hierarchy.parentName} (${hierarchy.parentCin || 'N/A'})` : null,
                hierarchy.ultimateParentName ? `Ultimate Parent: ${hierarchy.ultimateParentName} (${hierarchy.ultimateParentCin || 'N/A'})` : null,
                hierarchy.subsidiaries && hierarchy.subsidiaries.length > 0
                    ? `Subsidiaries:\n` + hierarchy.subsidiaries.map(s => `  * ${s.name} (${s.cin})`).join('\n')
                    : null,
                hierarchy.associates && hierarchy.associates.length > 0
                    ? `Associates / Joint Ventures:\n` + hierarchy.associates.map(a => `  * ${a.name} (${a.cin})`).join('\n')
                    : null
            ].filter(Boolean);

            const hierText = `[CORPORATE GROUP & SHAREHOLDING HIERARCHY - ${entity.canonicalName}]\n` +
                hierLines.join('\n');

            chunks.push({
                content: hierText,
                section: 'HIERARCHY',
                chunkIndex: chunkIndex++,
                contentHash: this.hashContent(hierText),
                metadata: {
                    entityId: entity.entityId,
                    canonicalName: entity.canonicalName,
                    section: 'HIERARCHY'
                }
            });
        }

        return chunks;
    }

    /**
     * Chunks an intent signal into a standardized RAG knowledge chunk.
     */
    static chunkSignal(signal: any): TextChunk[] {
        const companyName = signal.company_name_clean || signal.company_name_raw || 'Unknown Company';
        const lines = [
            `Company: ${companyName}`,
            signal.geo_state ? `State/Region: ${signal.geo_state} (${signal.geo_market || 'IN'})` : null,
            signal.sector_inferred ? `Sector: ${signal.sector_inferred}` : null,
            `Source: ${signal.source_id || 'signal'} (Tier: ${signal.source_tier || 'TIER_2'})`,
            signal.procurement_category ? `Procurement Category: ${signal.procurement_category}` : null,
            signal.buying_stage ? `Buying Stage: ${signal.buying_stage}` : null,
            signal.intent_score !== undefined ? `Intent Score: ${signal.intent_score}/100` : null,
            signal.card_why_now ? `Trigger: ${signal.card_why_now}` : null,
            signal.card_what_they_need ? `Requirement: ${signal.card_what_they_need}` : null,
            signal.collected_at ? `Observed At: ${signal.collected_at}` : null
        ].filter(Boolean);

        const text = `[MARKET INTENT SIGNAL]\n${lines.join('\n')}`;

        return [{
            content: text,
            section: 'SIGNAL',
            chunkIndex: 0,
            contentHash: this.hashContent(text),
            metadata: {
                companyName,
                sourceId: signal.source_id,
                sector: signal.sector_inferred,
                geoState: signal.geo_state,
                section: 'SIGNAL'
            }
        }];
    }

    /**
     * Chunks a Wiki document authored by a user.
     */
    static chunkWiki(entityId: string, title: string, markdown: string): TextChunk[] {
        const rawChunks = this.chunkText(markdown, 512, 50);
        if (rawChunks.length === 0) {
            rawChunks.push(`[COMPANY WIKI: ${title}]\n(No content provided yet)`);
        }

        return rawChunks.map((chunk, idx) => {
            const formatted = `[COMPANY WIKI: ${title} - Part ${idx + 1}/${rawChunks.length}]\n${chunk}`;
            return {
                content: formatted,
                section: 'WIKI',
                chunkIndex: idx,
                contentHash: this.hashContent(formatted),
                metadata: {
                    entityId,
                    title,
                    part: idx + 1,
                    totalParts: rawChunks.length,
                    section: 'WIKI'
                }
            };
        });
    }
}

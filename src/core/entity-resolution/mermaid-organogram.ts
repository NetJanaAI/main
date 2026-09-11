import { CanonicalEntity } from './types';

export interface MermaidOrganogramResult {
    diagram: string;
    nodeCount: number;
    isTruncated: boolean;
}

/**
 * Sanitizes labels for Mermaid nodes to prevent syntax breakage or SVG injection.
 * Strips characters that break Mermaid syntax: ", (, ), [, ], {, }, <, >, &, #, ;
 */
export function sanitizeMermaidLabel(text: string): string {
    if (!text) return '';
    return text
        .replace(/["“”']/g, '')
        .replace(/[(){}\[\]<>]/g, ' ')
        .replace(/&/g, 'and')
        .replace(/#/g, '')
        .replace(/;/g, ',')
        .replace(/\\/g, '/')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * Creates a deterministic, valid Mermaid node ID.
 */
export function makeMermaidId(prefix: string, rawKey: string): string {
    const clean = (rawKey || 'unknown').replace(/[^a-zA-Z0-9_]/g, '_');
    return `id_${prefix}_${clean}`;
}

const MAX_DIRECTORS = 5;
const MAX_SUBSIDIARIES = 10;
const MAX_ASSOCIATES = 5;

/**
 * Pure generator function to build an interactive corporate hierarchy organogram in Mermaid format.
 * Includes Ultimate Parent, Parent, Target Entity, Subsidiaries, Associates, and Governance Board.
 */
export function buildMermaidOrganogram(entity: CanonicalEntity): MermaidOrganogramResult {
    if (!entity) {
        return {
            diagram: 'graph TD\n    empty["No Entity Data Available"]',
            nodeCount: 1,
            isTruncated: false
        };
    }

    const lines: string[] = ['graph TD'];
    let nodeCount = 0;
    let isTruncated = false;

    // Theme Class Definitions for dark/modern UI styling
    lines.push('    %% Styling classes');
    lines.push('    classDef ultimate fill:#1e1b4b,stroke:#818cf8,stroke-width:2px,color:#ffffff;');
    lines.push('    classDef parent fill:#1e293b,stroke:#94a3b8,stroke-width:2px,color:#ffffff;');
    lines.push('    classDef target fill:#064e3b,stroke:#34d399,stroke-width:3px,color:#ffffff;');
    lines.push('    classDef subsidiary fill:#0f172a,stroke:#38bdf8,stroke-width:1px,color:#ffffff;');
    lines.push('    classDef associate fill:#1c1917,stroke:#fbbf24,stroke-width:1px,stroke-dasharray: 4 4,color:#ffffff;');
    lines.push('    classDef director fill:#2e1065,stroke:#c084fc,stroke-width:1px,color:#ffffff;');
    lines.push('    classDef truncated fill:#1f2937,stroke:#6b7280,stroke-width:1px,stroke-dasharray: 3 3,color:#9ca3af;');

    // 1. Target Node
    const targetKey = entity.cin || entity.entityId || 'target';
    const targetId = makeMermaidId('target', targetKey);
    const targetName = sanitizeMermaidLabel(entity.canonicalName || 'Target Company');
    const targetCinText = entity.cin ? `<br/>CIN: ${sanitizeMermaidLabel(entity.cin)}` : '';
    const targetStatusText = entity.companyStatus ? `<br/>[${sanitizeMermaidLabel(entity.companyStatus)}]` : '';
    
    lines.push(`    ${targetId}["🏢 ${targetName}${targetCinText}${targetStatusText}"]:::target`);
    nodeCount++;

    const hierarchy = entity.groupHierarchy || {};

    // 2. Ultimate Parent & Parent Nodes
    const hasUltimateParent = Boolean(hierarchy.ultimateParentCin || hierarchy.ultimateParentName);
    const hasParent = Boolean(hierarchy.parentCin || hierarchy.parentName);

    let ultParentId: string | null = null;
    if (hasUltimateParent) {
        const ultKey = hierarchy.ultimateParentCin || hierarchy.ultimateParentName || 'ultimate';
        ultParentId = makeMermaidId('ult', ultKey);
        const ultName = sanitizeMermaidLabel(hierarchy.ultimateParentName || 'Ultimate Parent');
        const ultCin = hierarchy.ultimateParentCin ? `<br/>CIN: ${sanitizeMermaidLabel(hierarchy.ultimateParentCin)}` : '';
        lines.push(`    ${ultParentId}["👑 ${ultName}${ultCin}"]:::ultimate`);
        nodeCount++;
    }

    let directParentId: string | null = null;
    if (hasParent && (!hasUltimateParent || hierarchy.parentCin !== hierarchy.ultimateParentCin)) {
        const pKey = hierarchy.parentCin || hierarchy.parentName || 'parent';
        directParentId = makeMermaidId('parent', pKey);
        const pName = sanitizeMermaidLabel(hierarchy.parentName || 'Holding / Parent');
        const pCin = hierarchy.parentCin ? `<br/>CIN: ${sanitizeMermaidLabel(hierarchy.parentCin)}` : '';
        lines.push(`    ${directParentId}["🏛️ ${pName}${pCin}"]:::parent`);
        nodeCount++;
    }

    // Connect parents
    if (ultParentId && directParentId) {
        lines.push(`    ${ultParentId} -->|Controls| ${directParentId}`);
        lines.push(`    ${directParentId} -->|Direct Parent| ${targetId}`);
    } else if (ultParentId) {
        lines.push(`    ${ultParentId} -->|Controls| ${targetId}`);
    } else if (directParentId) {
        lines.push(`    ${directParentId} -->|Direct Parent| ${targetId}`);
    }

    // 3. Subsidiaries
    const subsidiaries = hierarchy.subsidiaries || [];
    if (subsidiaries.length > 0) {
        const visibleSubs = subsidiaries.slice(0, MAX_SUBSIDIARIES);
        visibleSubs.forEach((sub, idx) => {
            const subKey = sub.cin || `sub_${idx}`;
            const subId = makeMermaidId('sub', subKey);
            const subName = sanitizeMermaidLabel(sub.name || 'Subsidiary Company');
            const subCin = sub.cin ? `<br/>CIN: ${sanitizeMermaidLabel(sub.cin)}` : '';
            lines.push(`    ${subId}["🏭 ${subName}${subCin}"]:::subsidiary`);
            lines.push(`    ${targetId} -->|Subsidiary| ${subId}`);
            nodeCount++;
        });

        if (subsidiaries.length > MAX_SUBSIDIARIES) {
            isTruncated = true;
            const remaining = subsidiaries.length - MAX_SUBSIDIARIES;
            const truncId = makeMermaidId('sub_trunc', targetKey);
            lines.push(`    ${truncId}["... and ${remaining} more subsidiaries"]:::truncated`);
            lines.push(`    ${targetId} -.-> ${truncId}`);
            nodeCount++;
        }
    }

    // 4. Associates
    const associates = hierarchy.associates || [];
    if (associates.length > 0) {
        const visibleAssocs = associates.slice(0, MAX_ASSOCIATES);
        visibleAssocs.forEach((assoc, idx) => {
            const assocKey = assoc.cin || `assoc_${idx}`;
            const assocId = makeMermaidId('assoc', assocKey);
            const assocName = sanitizeMermaidLabel(assoc.name || 'Associate Entity');
            const assocCin = assoc.cin ? `<br/>CIN: ${sanitizeMermaidLabel(assoc.cin)}` : '';
            lines.push(`    ${assocId}["🤝 ${assocName}${assocCin}"]:::associate`);
            lines.push(`    ${targetId} -.->|Associate Interest| ${assocId}`);
            nodeCount++;
        });

        if (associates.length > MAX_ASSOCIATES) {
            isTruncated = true;
            const remaining = associates.length - MAX_ASSOCIATES;
            const truncId = makeMermaidId('assoc_trunc', targetKey);
            lines.push(`    ${truncId}["... and ${remaining} more associates"]:::truncated`);
            lines.push(`    ${targetId} -.-> ${truncId}`);
            nodeCount++;
        }
    }

    // 5. Governance / Board of Directors
    const directors = entity.directors || [];
    if (directors.length > 0) {
        const visibleDirs = directors.slice(0, MAX_DIRECTORS);
        visibleDirs.forEach((dir, idx) => {
            const dirKey = dir.din || `dir_${idx}`;
            const dirId = makeMermaidId('dir', dirKey);
            const dirName = sanitizeMermaidLabel(dir.name || 'Director');
            const dirDesig = dir.designation ? ` - ${sanitizeMermaidLabel(dir.designation)}` : '';
            const dirDin = dir.din ? `<br/>DIN: ${sanitizeMermaidLabel(dir.din)}` : '';
            lines.push(`    ${dirId}["👤 ${dirName}${dirDesig}${dirDin}"]:::director`);
            lines.push(`    ${targetId} ---|Director| ${dirId}`);
            nodeCount++;
        });

        if (directors.length > MAX_DIRECTORS) {
            isTruncated = true;
            const remaining = directors.length - MAX_DIRECTORS;
            const truncId = makeMermaidId('dir_trunc', targetKey);
            lines.push(`    ${truncId}["... and ${remaining} other directors"]:::truncated`);
            lines.push(`    ${targetId} ---|Director| ${truncId}`);
            nodeCount++;
        }
    }

    return {
        diagram: lines.join('\n'),
        nodeCount,
        isTruncated
    };
}

import * as fs from 'fs';
import * as path from 'path';

/**
 * ConvoSpan Security Guardrail Scanner
 * 
 * Programmatically scans the workspace to verify compliance with:
 * 1. Strict Schema Validation (Zod schemas at HTTP boundaries)
 * 2. Parameterized SQL queries (No string templates/concatenations in db.query/queryWithOrg/queryAsSystem)
 * 3. Safe Command Execution (Avoiding unsafe child_process.exec)
 * 4. Secrets Isolation (No hardcoded API credentials/secrets in production environments)
 */

interface ScanResult {
    file: string;
    line: number;
    rule: string;
    description: string;
    codeSnippet: string;
}

const RESULTS: ScanResult[] = [];
const EXCLUDED_DIRS = new Set(['node_modules', 'dist', 'build', '.git', '.vscode', 'tmp', 'client']);

function scanDirectory(dir: string) {
    const files = fs.readdirSync(dir);
    for (const file of files) {
        const fullPath = path.join(dir, file);
        const stat = fs.statSync(fullPath);

        if (stat.isDirectory()) {
            if (!EXCLUDED_DIRS.has(file)) {
                scanDirectory(fullPath);
            }
        } else if (file.endsWith('.ts') || file.endsWith('.js') || file.endsWith('.tsx')) {
            scanFile(fullPath);
        }
    }
}

function scanFile(filePath: string) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    lines.forEach((line, index) => {
        const lineNum = index + 1;

        // 1. Safe Command Execution Guardrail
        if (line.includes('child_process') && line.includes('exec(') && !filePath.includes('verify-security')) {
            RESULTS.push({
                file: filePath,
                line: lineNum,
                rule: 'SEC-COMMAND-EXECUTION',
                description: 'Unsafe command execution: Use spawn or execFile instead of exec to avoid shell command injections.',
                codeSnippet: line.trim()
            });
        }

        // 2. Parameterized SQL Guardrail
        // Matches DB queries that use string templates or concatenations directly.
        // Excludes .query( calls on RAG/vector stores by verifying db.query context.
        const queryMatch = line.match(/\b(db|client)\.(query|queryWithOrg|queryAsSystem)\s*\(\s*`[^`]*\$\{[^}]+\}[^`]*`/);
        const concatMatch = line.match(/\b(db|client)\.(query|queryWithOrg|queryAsSystem)\s*\(\s*["'][^"']*\+[^"']*["']\s*\)/);
        if (queryMatch || concatMatch) {
            RESULTS.push({
                file: filePath,
                line: lineNum,
                rule: 'SEC-PARAMETERIZED-SQL',
                description: 'Dynamic SQL query construction detected: Ensure all queries are parameterized using $1, $2 placeholders.',
                codeSnippet: line.trim()
            });
        }

        // 3. Secrets Isolation Guardrail
        if (
            (line.toLowerCase().includes('key') || line.toLowerCase().includes('secret')) && 
            !filePath.includes('__tests__') && 
            !filePath.includes('verify') &&
            !filePath.includes('database') && 
            !filePath.includes('test-netjana-push') && // Mock test script bypass
            !filePath.includes('secrets.ts')  // Central configurations
        ) {
            // Match assignments to string literals containing letters/numbers (exclude empty strings or config names)
            const secretAssign = line.match(/(api_key|secret|token|password|auth_key)\s*[:=]\s*["'](?![•\s"']+$)[a-zA-Z0-9\-_]{16,}["']/i);
            if (secretAssign) {
                RESULTS.push({
                    file: filePath,
                    line: lineNum,
                    rule: 'SEC-SECRETS-ISOLATION',
                    description: 'Possible hardcoded secret or API key credential: Store config in environment variables or load dynamically.',
                    codeSnippet: line.trim()
                });
            }
        }
    });

    // 4. Schema Validation (Router Boundaries)
    if (filePath.includes('src/routes/') && !filePath.includes('reports.ts')) {
        const hasZod = content.includes('z.object') || content.includes('Schema.parse') || content.includes('Schema.safeParse') || content.includes('Schema.omit') || content.includes('Schema.pick');
        const hasPost = content.includes('router.post') || content.includes('router.put') || content.includes('router.patch');
        
        if (hasPost && !hasZod) {
            RESULTS.push({
                file: filePath,
                line: 1,
                rule: 'SEC-SCHEMA-VALIDATION',
                description: 'Express router file implements post/put/patch endpoints but does not import or execute Zod validations.',
                codeSnippet: 'File Header'
            });
        }
    }
}

// Execute Scan
const targetDir = path.resolve(__dirname, '..');
console.log(`[Security Scanner] Initiating scan in target: ${targetDir}`);
scanDirectory(targetDir);

console.log('\n=========================================');
console.log(`[Security Scanner] Scan Completed. Found ${RESULTS.length} issues.`);
console.log('=========================================\n');

if (RESULTS.length > 0) {
    RESULTS.forEach((r, i) => {
        console.log(`[${i + 1}] Rule: ${r.rule} (${r.description})`);
        console.log(`    File: ${r.file}:${r.line}`);
        console.log(`    Code: ${r.codeSnippet}\n`);
    });
    process.exit(1);
} else {
    console.log('[Security Scanner] ✅ Clean scan. No custom security guardrail violations found.');
    process.exit(0);
}

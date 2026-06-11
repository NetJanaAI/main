import { z } from 'zod';
import { Page } from 'playwright';
import { callModel, parseModelJson } from '../lib/model-api';
import { jsonToToon } from '../lib/ai/toon';
import { TokenTracker } from '../lib/ai/token-tracker';

/**
 * Helper to convert Zod schema fields (if present) into a standard Record<string, string>
 * for compact TOON serialization in the prompt.
 */
function extractSchemaFields(schema: any): Record<string, string> {
    if (schema && typeof schema === 'object') {
        if ('shape' in schema) {
            const schemaMap: Record<string, string> = {};
            for (const [key, val] of Object.entries(schema.shape)) {
                let typeStr = 'string';
                if (val instanceof z.ZodNumber) typeStr = 'number';
                else if (val instanceof z.ZodBoolean) typeStr = 'boolean';
                else if (val instanceof z.ZodDate) typeStr = 'ISO date';
                else if (val instanceof z.ZodArray) typeStr = 'array';
                schemaMap[key] = typeStr;
            }
            return schemaMap;
        }
    }
    return schema;
}

/**
 * Performs Google search by opening a new page inside the active Playwright context.
 * Extract search result snippets for grounding.
 */
async function searchGoogle(query: string, page: Page): Promise<string[]> {
    const searchPage = await page.context().newPage();
    try {
        await searchPage.goto(`https://www.google.com/search?q=${encodeURIComponent(query)}`, { 
            waitUntil: 'domcontentloaded', 
            timeout: 15000 
        });
        
        // Extract title and text snippets from the search results page
        const snippets = await searchPage.evaluate(() => {
            const results: string[] = [];
            const items = document.querySelectorAll('div.g');
            items.forEach(item => {
                const title = item.querySelector('h3')?.innerText || '';
                const snippet = (item.querySelector('.VwiC3b') as HTMLElement)?.innerText || '';
                if (title || snippet) {
                    results.push(`${title}: ${snippet}`);
                }
            });
            return results.slice(0, 3); // Top 3 results
        });
        return snippets;
    } catch (e: any) {
        console.warn('[AdaptiveExtractor:GoogleSearch] Search failed:', e.message);
        return [];
    } finally {
        await searchPage.close();
    }
}

/**
 * Initial extraction from raw HTML page content.
 */
async function runExtraction(
    rawHtml: string,
    targetSchema: Record<string, string>,
    source: string,
    orgId: string,
    spendKey: string
): Promise<Record<string, unknown>> {
    const toonSchema = jsonToToon(targetSchema);
    const schemaTokensSaved = TokenTracker.calculateToonSavings({ schema: targetSchema }, toonSchema);

    const prompt = `
Extract the following fields from this HTML page.
Source: ${source}
Required fields (in TOON format):
${toonSchema}

Return ONLY valid JSON matching the schema fields. If a field is missing, return null for it.
HTML:
${rawHtml.slice(0, 8000)}
    `.trim();

    const resultRaw = await callModel({
        role: 'qualifier',
        system: 'You are an adaptive web scraper extraction engine. Respond with a JSON object matching the requested schema. Respond in JSON only.',
        user: prompt,
        orgId,
        spendKey,
        tokensSaved: schemaTokensSaved
    });

    const parsed = parseModelJson(resultRaw);
    if (!parsed) {
        throw new Error('Failed to parse extracted JSON from model response.');
    }
    return parsed;
}

/**
 * Multi-step grounding refinement loop using Google search context.
 */
async function runGroundingRefinement(
    initialData: Record<string, unknown>,
    targetSchema: Record<string, string>,
    groundingSnippets: string[],
    source: string,
    orgId: string,
    spendKey: string
): Promise<Record<string, unknown>> {
    const toonSchema = jsonToToon(targetSchema);
    const schemaTokensSaved = TokenTracker.calculateToonSavings({ schema: targetSchema }, toonSchema);

    const prompt = `
You are verifying and grounding the following extracted fields from an HTML page.
Source: ${source}

Initial extraction:
${jsonToToon(initialData)}

Google Search Grounding Context:
${groundingSnippets.join('\n')}

Verify the initial extracted fields against the Google search results and correct/enrich them if necessary.
Return ONLY valid JSON matching the schema fields. If a field is missing, return null for it.
    `.trim();

    const resultRaw = await callModel({
        role: 'qualifier',
        system: 'You are a B2B grounding agent. Verify and refine the structured data using Google search results. Respond in JSON only.',
        user: prompt,
        orgId,
        spendKey,
        tokensSaved: schemaTokensSaved
    });

    const parsed = parseModelJson(resultRaw);
    if (!parsed) {
        throw new Error('Failed to parse grounded JSON from model response.');
    }
    return parsed;
}

/**
 * Extracts schema-conforming structured data from HTML pages.
 * Supports:
 * - Dynamic Zod schema validation & type parsing.
 * - Local fallback execution in DEMO_MODE.
 * - Google search-based grounding and data verification using the active Playwright context.
 */
export async function extractWithLLM(
    rawHtml: string,
    schema: Record<string, string> | z.ZodObject<any>,
    source: string,
    orgId: string = 'default',
    spendKey?: string,
    page?: Page,
    enableSearch = false
): Promise<Record<string, unknown>> {
    // 1. DEMO_MODE Fallback Checks (when no LLM keys are configured)
    const isDemoMode = !process.env.GOOGLE_API_KEY && !process.env.OLLAMA_HOST && !process.env.LITELLM_API_BASE;
    if (isDemoMode) {
        const targetSchema = extractSchemaFields(schema);
        const mockData: Record<string, any> = {};
        for (const [key, type] of Object.entries(targetSchema)) {
            if (type === 'number') {
                mockData[key] = 42;
            } else if (type === 'boolean') {
                mockData[key] = true;
            } else if (type.toLowerCase().includes('date')) {
                mockData[key] = new Date().toISOString();
            } else {
                mockData[key] = `mock_${key}`;
            }
        }

        // Validate using Zod if Zod schema was provided
        if (schema && typeof schema === 'object' && 'safeParse' in schema) {
            const validationResult = (schema as z.ZodTypeAny).safeParse(mockData);
            if (!validationResult.success) {
                return mockData;
            }
            return validationResult.data as Record<string, unknown>;
        }
        return mockData;
    }

    const targetSchema = extractSchemaFields(schema);
    const activeSpendKey = spendKey || `gemini_calls:${new Date().toISOString().split('T')[0]}`;

    // 2. Run initial page-based extraction
    const initialData = await runExtraction(rawHtml, targetSchema, source, orgId, activeSpendKey);

    // 3. Build Google search query for grounding
    let query = '';
    if (initialData.companyName && typeof initialData.companyName === 'string') {
        query = `${initialData.companyName} corporate registration info`;
    } else if (initialData.tenderTitle && typeof initialData.tenderTitle === 'string') {
        query = `${initialData.tenderTitle} tender status details`;
    } else if (initialData.tender_title && typeof initialData.tender_title === 'string') {
        query = `${initialData.tender_title} tender reference`;
    } else {
        query = `${new URL(source).hostname} corporate profile`;
    }

    // 4. Perform Google search and gather grounding context
    let groundingSnippets: string[] = [];
    if (enableSearch && page && query) {
        try {
            if (!page.isClosed()) {
                groundingSnippets = await searchGoogle(query, page);
            }
        } catch (searchErr: any) {
            console.warn('[AdaptiveExtractor] Search failed:', searchErr.message);
        }
    }

    // 5. Verify & refine extraction data using Google search grounding
    let finalData = initialData;
    if (groundingSnippets.length > 0) {
        finalData = await runGroundingRefinement(initialData, targetSchema, groundingSnippets, source, orgId, activeSpendKey);
    }

    // 6. Validate output against Zod schema (if provided)
    if (schema && typeof schema === 'object' && 'safeParse' in schema) {
        const validationResult = (schema as z.ZodTypeAny).safeParse(finalData);
        if (!validationResult.success) {
            throw new Error(`Extraction schema validation failed: ${validationResult.error.message}`);
        }
        return validationResult.data as Record<string, unknown>;
    }

    return finalData;
}

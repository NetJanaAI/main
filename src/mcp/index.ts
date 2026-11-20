import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { 
    CallToolRequestSchema, 
    ListToolsRequestSchema,
    ListResourcesRequestSchema,
    ReadResourceRequestSchema
} from "@modelcontextprotocol/sdk/types.js";
import { scrapeB2BSignals } from "../engines/b2bScraper.js";
import { queryWithOrg } from "../lib/database.js";
import { v4 as uuidv4 } from 'uuid';

/**
 * The stdio client is not a tenant, so the server is bound to one organization through MCP_ORG_ID
 * and every query runs inside that organization's row-level security context.
 */
const mcpOrgId = (): string | undefined => process.env.MCP_ORG_ID?.trim() || undefined;

const server = new Server(
    {
        name: "netjana-sovereign-scraper",
        version: "2.0.0",
    },
    {
        capabilities: {
            resources: {},
            tools: {},
        },
    }
);

/**
 * List available tools.
 */
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return {
        tools: [
            {
                name: "scrape_intent",
                description: "Perform an intent-based B2B scrape on a target domain.",
                inputSchema: {
                    type: "object",
                    properties: {
                        url: { type: "string", description: "Target URL (e.g., https://example.com)" },
                        intent: { type: "string", description: "User intent or keywords (e.g., 'corporate leadership')" },
                        spiderMode: { type: "boolean", description: "Enable multi-page crawl" }
                    },
                    required: ["url", "intent"]
                }
            },
            {
                name: "get_campaign_status",
                description: "Retrieve current status of B2B campaigns.",
                inputSchema: {
                    type: "object",
                    properties: {
                        domain: { type: "string" }
                    }
                }
            }
        ]
    };
});

/**
 * Handle tool calls.
 */
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    switch (request.params.name) {
        case "scrape_intent": {
            const { url, spiderMode } = request.params.arguments as any;
            const jobId = uuidv4();
            // Trigger scrape (Note: We use the engine directly here or could enqueue)
            // Corrected argument order: (targetUrl, maxRetries, onProgress, forceFailure, useOnlineAI, jobId, spiderMode, maxPages)
            const result = await scrapeB2BSignals(url, 1, null, false, true, jobId, spiderMode || false, 5);
            return {
                content: [{ type: "text", text: JSON.stringify(result, null, 2) }]
            };
        }
        case "get_campaign_status": {
            const domain = request.params.arguments?.domain as string;
            const sql = domain ? "SELECT * FROM campaigns WHERE domain = $1" : "SELECT * FROM campaigns";
            const res = await queryWithOrg(sql, domain ? [domain] : [], mcpOrgId());
            return {
                content: [{ type: "text", text: JSON.stringify(res.rows, null, 2) }]
            };
        }
        default:
            throw new Error("Unknown tool");
    }
});

/**
 * List available resources.
 */
server.setRequestHandler(ListResourcesRequestSchema, async () => {
    return {
        resources: [
            {
                uri: "history://latest",
                name: "Latest Scrape Results",
                description: "A list of the most recent intelligence outputs",
                mimeType: "application/json"
            }
        ]
    };
});

/**
 * Read resources.
 */
server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
    if (request.params.uri === "history://latest") {
        const res = await queryWithOrg("SELECT * FROM scrape_results ORDER BY timestamp DESC LIMIT 5", [], mcpOrgId());
        return {
            contents: [{
                uri: request.params.uri,
                mimeType: "application/json",
                text: JSON.stringify(res.rows, null, 2)
            }]
        };
    }
    throw new Error("Resource not found");
});

export async function startMcpServer() {
    if (!mcpOrgId()) {
        console.error("NetJana MCP Server not started: set MCP_ORG_ID to the organization it should serve.");
        return;
    }
    try {
        const transport = new StdioServerTransport();
        await server.connect(transport);
        console.error("NetJana MCP Server running on stdio");
    } catch (error) {
        console.error("MCP Server error:", error);
    }
}

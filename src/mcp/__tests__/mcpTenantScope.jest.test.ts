const handlers = new Map<unknown, (req: any) => Promise<any>>();
const connect = jest.fn().mockResolvedValue(undefined);
const queryWithOrg = jest.fn();

jest.mock('@modelcontextprotocol/sdk/server/index.js', () => ({
    Server: jest.fn().mockImplementation(() => ({
        setRequestHandler: (schema: unknown, fn: (req: any) => Promise<any>) => handlers.set(schema, fn),
        connect,
    })),
}));
jest.mock('@modelcontextprotocol/sdk/server/stdio.js', () => ({ StdioServerTransport: jest.fn() }));
jest.mock('@modelcontextprotocol/sdk/types.js', () => ({
    CallToolRequestSchema: 'call',
    ListToolsRequestSchema: 'tools',
    ListResourcesRequestSchema: 'resources',
    ReadResourceRequestSchema: 'read',
}));
jest.mock('../../engines/b2bScraper.js', () => ({ scrapeB2BSignals: jest.fn() }));
jest.mock('../../lib/database.js', () => ({ queryWithOrg: (...a: any[]) => queryWithOrg(...a) }));

import { startMcpServer } from '../index';

describe('MCP server tenant scope', () => {
    beforeEach(() => {
        queryWithOrg.mockReset().mockResolvedValue({ rows: [] });
        connect.mockClear();
        jest.spyOn(console, 'error').mockImplementation(() => {});
    });
    afterEach(() => {
        delete process.env.MCP_ORG_ID;
        jest.restoreAllMocks();
    });

    it('does not start without MCP_ORG_ID', async () => {
        await startMcpServer();
        expect(connect).not.toHaveBeenCalled();
    });

    it('starts when an organization is configured', async () => {
        process.env.MCP_ORG_ID = 'org_a';
        await startMcpServer();
        expect(connect).toHaveBeenCalledTimes(1);
    });

    it('reads campaigns inside the configured organization', async () => {
        process.env.MCP_ORG_ID = ' org_a ';
        await handlers.get('call')!({ params: { name: 'get_campaign_status', arguments: { domain: 'acme.com' } } });
        expect(queryWithOrg).toHaveBeenCalledWith(expect.stringContaining('FROM campaigns'), ['acme.com'], 'org_a');
    });

    it('reads recent results inside the configured organization', async () => {
        process.env.MCP_ORG_ID = 'org_a';
        await handlers.get('read')!({ params: { uri: 'history://latest' } });
        expect(queryWithOrg).toHaveBeenCalledWith(expect.stringContaining('FROM scrape_results'), [], 'org_a');
    });
});

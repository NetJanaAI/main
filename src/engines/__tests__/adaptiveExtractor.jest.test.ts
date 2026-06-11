import { z } from 'zod';
import { extractWithLLM } from '../adaptiveExtractor';
import { callModel } from '../../lib/model-api';
import { Page } from 'playwright';

// Mock model-api to intercept calls to callModel
jest.mock('../../lib/model-api', () => ({
    callModel: jest.fn(),
    parseModelJson: jest.fn().mockImplementation((raw) => {
        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }),
}));

// Mock database to avoid connection issues
jest.mock('../../lib/database', () => ({
    query: jest.fn(),
    queryWithOrg: jest.fn(),
}));

// Mock ioredis to prevent hanging during tests
jest.mock('ioredis', () => {
    return jest.fn().mockImplementation(() => {
        return {
            on: jest.fn(),
            get: jest.fn().mockResolvedValue(null),
            set: jest.fn().mockResolvedValue('OK'),
            decr: jest.fn().mockResolvedValue(0),
            pipeline: jest.fn().mockReturnValue({
                incr: jest.fn().mockReturnThis(),
                expire: jest.fn().mockReturnThis(),
                exec: jest.fn().mockResolvedValue([[null, 1], [null, 1]]),
            }),
        };
    });
});

// Mock bullmq
jest.mock('bullmq', () => ({
    Queue: jest.fn().mockImplementation(() => ({
        add: jest.fn().mockResolvedValue({ id: 'mock-job' }),
    })),
    Worker: jest.fn().mockImplementation(() => ({
        on: jest.fn(),
        close: jest.fn(),
    })),
}));

describe('Adaptive Extractor Engine', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    describe('DEMO_MODE Fallback behavior', () => {
        it('returns realistic mock structured data conforming to the schema types when no API keys are present', async () => {
            // Force DEMO_MODE by clearing keys
            delete process.env.GOOGLE_API_KEY;
            delete process.env.OLLAMA_HOST;
            delete process.env.LITELLM_API_BASE;

            const schema = {
                tenderTitle: 'string',
                deadline: 'ISO date',
                budget: 'number',
                isActive: 'boolean'
            };

            const result = await extractWithLLM('<html>Mock HTML</html>', schema, 'http://example.com/tenders');

            expect(callModel).not.toHaveBeenCalled();
            expect(result).toEqual({
                tenderTitle: 'mock_tenderTitle',
                deadline: expect.any(String), // should be ISO date string
                budget: 42,
                isActive: true
            });

            // Ensure the date string is indeed parsable as a date
            expect(Date.parse(result.deadline as string)).not.toBeNaN();
        });

        it('supports Zod schemas in DEMO_MODE and parses/validates output', async () => {
            // Force DEMO_MODE by clearing keys
            delete process.env.GOOGLE_API_KEY;
            delete process.env.OLLAMA_HOST;
            delete process.env.LITELLM_API_BASE;

            const schema = z.object({
                companyName: z.string(),
                jobTitle: z.string(),
                postedDate: z.string(),
                location: z.string()
            });

            const result = await extractWithLLM('<html>Mock HTML</html>', schema, 'http://example.com/jobs');

            expect(callModel).not.toHaveBeenCalled();
            expect(result).toEqual({
                companyName: 'mock_companyName',
                jobTitle: 'mock_jobTitle',
                postedDate: expect.any(String),
                location: 'mock_location'
            });
        });
    });

    describe('Live / LLM-Enabled behavior with Zod Schemas', () => {
        it('compresses schema via TOON and calls callModel, then validates output using Zod', async () => {
            // Enable LLM mode
            process.env.GOOGLE_API_KEY = 'mock-api-key';

            const mockExtractedResponse = {
                companyName: 'Apex Labs',
                jobTitle: 'Senior Rust Engineer',
                postedDate: '2026-06-11T12:00:00Z',
                location: 'Bengaluru'
            };

            (callModel as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockExtractedResponse));

            const schema = z.object({
                companyName: z.string(),
                jobTitle: z.string(),
                postedDate: z.string(),
                location: z.string()
            });

            const result = await extractWithLLM(
                '<html>Acme Careers</html>',
                schema,
                'http://example.com/careers'
            );

            expect(callModel).toHaveBeenCalledTimes(1);
            expect(result).toEqual(mockExtractedResponse);
        });

        it('throws validation error if parsed LLM response does not match the Zod schema', async () => {
            process.env.GOOGLE_API_KEY = 'mock-api-key';

            const mockInvalidResponse = {
                companyName: 12345, // Invalid type, expects string
                jobTitle: 'Developer'
            };

            (callModel as jest.Mock).mockResolvedValueOnce(JSON.stringify(mockInvalidResponse));

            const schema = z.object({
                companyName: z.string(),
                jobTitle: z.string()
            });

            await expect(
                extractWithLLM('<html>HTML</html>', schema, 'http://example.com')
            ).rejects.toThrow('Extraction schema validation failed');
        });
    });

    describe('Google Search Grounding', () => {
        it('performs search and triggers grounding model refinement if enableSearch and page are provided', async () => {
            process.env.GOOGLE_API_KEY = 'mock-api-key';

            const mockInitialResponse = {
                companyName: 'Reliance Industries',
                status: 'Active'
            };
            const mockGroundedResponse = {
                companyName: 'Reliance Industries Limited', // Refined
                status: 'Active'
            };

            // Two sequential calls to callModel: runExtraction then runGroundingRefinement
            (callModel as jest.Mock)
                .mockResolvedValueOnce(JSON.stringify(mockInitialResponse))
                .mockResolvedValueOnce(JSON.stringify(mockGroundedResponse));

            // Mock page.context().newPage() and searchPage.goto() / evaluate()
            const mockSearchPage = {
                goto: jest.fn().mockResolvedValue(null),
                evaluate: jest.fn().mockResolvedValue([
                    'Reliance Industries Limited: Official corporate profile and news updates',
                    'Reliance Industries: Key details, stock details, and director list'
                ]),
                close: jest.fn().mockResolvedValue(null),
            };

            const mockPage = {
                isClosed: jest.fn().mockReturnValue(false),
                context: jest.fn().mockReturnValue({
                    newPage: jest.fn().mockResolvedValue(mockSearchPage)
                })
            } as unknown as Page;

            const schema = {
                companyName: 'string',
                status: 'string'
            };

            const result = await extractWithLLM(
                '<html>HTML</html>',
                schema,
                'http://example.com/company',
                'org-123',
                'spend-key-123',
                mockPage,
                true // enableSearch
            );

            // Grounding loop should query google search and do 2 model calls
            expect(mockPage.context().newPage).toHaveBeenCalledTimes(1);
            expect(mockSearchPage.goto).toHaveBeenCalledWith(expect.stringContaining('q=Reliance%20Industries'), expect.any(Object));
            expect(callModel).toHaveBeenCalledTimes(2);
            expect(result).toEqual(mockGroundedResponse);
        });
    });
});

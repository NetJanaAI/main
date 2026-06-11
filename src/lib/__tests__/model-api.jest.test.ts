import { callModel } from '../model-api';
import { ChatOpenAI } from '@langchain/openai';
import { ChatGoogleGenerativeAI } from '@langchain/google-genai';

// Mock dependencies
jest.mock('@langchain/openai', () => ({
    ChatOpenAI: jest.fn().mockImplementation(() => ({
        invoke: jest.fn().mockResolvedValue({
            content: '{"mocked": "litellm"}',
            usage_metadata: { input_tokens: 10, output_tokens: 20 },
        }),
    })),
}));

jest.mock('@langchain/google-genai', () => ({
    ChatGoogleGenerativeAI: jest.fn().mockImplementation(() => ({
        invoke: jest.fn().mockResolvedValue({
            content: '{"mocked": "gemini"}',
            usage_metadata: { input_tokens: 10, output_tokens: 20 },
        }),
    })),
}));

jest.mock('../ai/token-tracker', () => ({
    TokenTracker: {
        recordUsage: jest.fn().mockResolvedValue(true),
        estimateTokens: jest.fn().mockReturnValue(5),
        calculateToonSavings: jest.fn().mockReturnValue(0),
    },
}));

// Mock database to avoid connection issues
jest.mock('../database', () => ({
    query: jest.fn(),
    queryWithOrg: jest.fn(),
}));

// Mock ioredis
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

describe('ModelAPI - LiteLLM Integration', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        jest.resetModules();
        process.env = { ...originalEnv };
        jest.clearAllMocks();
    });

    afterEach(() => {
        process.env = originalEnv;
    });

    it('routes requests to ChatOpenAI when LITELLM_API_BASE is set', async () => {
        process.env.LITELLM_API_BASE = 'http://localhost:4000/v1';
        process.env.LITELLM_MASTER_KEY = 'secret-master-key';

        const result = await callModel({
            role: 'gate',
            system: 'System rules',
            user: 'User payload',
            orgId: 'org-123',
            spendKey: 'spend-123',
        });

        expect(ChatOpenAI).toHaveBeenCalledTimes(1);
        expect(ChatOpenAI).toHaveBeenCalledWith(expect.objectContaining({
            configuration: {
                baseURL: 'http://localhost:4000/v1',
            },
            openAIApiKey: 'secret-master-key',
            model: 'gemini-2.0-flash',
        }));
        expect(ChatGoogleGenerativeAI).not.toHaveBeenCalled();
        expect(result).toBe('{"mocked": "litellm"}');
    });

    it('falls back to ChatGoogleGenerativeAI when LITELLM_API_BASE is absent but GOOGLE_API_KEY is present', async () => {
        delete process.env.LITELLM_API_BASE;
        process.env.GOOGLE_API_KEY = 'gemini-key-123';

        const result = await callModel({
            role: 'gate',
            system: 'System rules',
            user: 'User payload',
            orgId: 'org-123',
            spendKey: 'spend-123',
        });

        expect(ChatGoogleGenerativeAI).toHaveBeenCalledTimes(1);
        expect(ChatGoogleGenerativeAI).toHaveBeenCalledWith(expect.objectContaining({
            model: 'gemini-2.0-flash',
        }));
        expect(ChatOpenAI).not.toHaveBeenCalled();
        expect(result).toBe('{"mocked": "gemini"}');
    });
});

import { scrapeB2BSignals } from '../b2bScraper';
import { chromium } from 'playwright';
import { checkLegalSafety } from '../../sentinel/compliance';
import { validateTargetUrl } from '../../middleware/urlValidator';
import { sendResults } from '../../dispatcher';
import { AuditTrail } from '../../core/compliance/AuditTrail';
import { TenantRAGStore } from '../../core/rag/TenantRAGStore';
import { AdversarialCritic } from '../AdversarialCritic';
import { scrapeCount } from '../../lib/telemetry';

const mockPage = {
    close: jest.fn().mockResolvedValue(null),
    route: jest.fn().mockResolvedValue(null),
    goto: jest.fn().mockResolvedValue(null),
    title: jest.fn().mockResolvedValue('Mock Title'),
    evaluate: jest.fn().mockResolvedValue('Mock content longer than 200 characters to pass sparse check...'.repeat(5)),
    screenshot: jest.fn().mockResolvedValue(null),
};

const mockContext = {
    newPage: jest.fn().mockResolvedValue(mockPage),
    addInitScript: jest.fn(),
};

const mockBrowser = {
    newContext: jest.fn().mockResolvedValue(mockContext),
    close: jest.fn().mockResolvedValue(null),
};

jest.mock('playwright', () => ({
    chromium: {
        launch: jest.fn().mockImplementation(() => Promise.resolve(mockBrowser)),
    },
}));

jest.mock('../../sentinel/compliance', () => ({
    checkLegalSafety: jest.fn().mockResolvedValue(true),
}));

jest.mock('../../middleware/urlValidator', () => ({
    validateTargetUrl: jest.fn().mockResolvedValue({ isValid: true, resolvedIp: '127.0.0.1' }),
}));

jest.mock('../../dispatcher', () => ({
    sendResults: jest.fn().mockResolvedValue(null),
}));

jest.mock('../../core/compliance/AuditTrail', () => ({
    AuditTrail: {
        log: jest.fn().mockResolvedValue(null),
    },
}));

jest.mock('../../core/rag/TenantRAGStore', () => ({
    TenantRAGStore: jest.fn().mockImplementation(() => ({
        upsert: jest.fn().mockResolvedValue(true),
        clearJobData: jest.fn().mockResolvedValue(true),
    })),
}));

jest.mock('../AdversarialCritic', () => ({
    AdversarialCritic: jest.fn().mockImplementation(() => ({
        analyze: jest.fn().mockResolvedValue({
            frictionScore: 50,
            intentSummary: 'High Intent',
            painPoints: { technicalDebt: [], operationalBottlenecks: [], strategicAlpha: [] },
        }),
    })),
}));

jest.mock('../../lib/telemetry', () => ({
    scrapeCount: { inc: jest.fn() },
    scrapeDuration: { observe: jest.fn() },
    complianceVetoCount: { inc: jest.fn() },
}));

jest.mock('../../lib/queue', () => ({
    influenceQueue: {
        add: jest.fn().mockResolvedValue(null),
    },
}));

jest.mock('geoip-lite', () => ({
    lookup: jest.fn().mockReturnValue({ country: 'IN' }),
}));

// Mock database to avoid connection issues
jest.mock('../../lib/database', () => ({
    query: jest.fn(),
    queryWithOrg: jest.fn(),
}));

describe('scrapeB2BSignals browser lifecycle on retry', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('should retry and launch/close a fresh browser on failure', async () => {
        const targetUrl = 'https://example.com/b2b-leads';
        const maxRetries = 3;

        // Execute scraper, forcing simulated engine failure
        await expect(
            scrapeB2BSignals(
                targetUrl,
                maxRetries,
                undefined,
                true // forceFailure = true
            )
        ).rejects.toThrow('Simulated Engine Failure for Resilience Testing.');

        // Verify that chromium.launch was called exactly maxRetries times
        expect(chromium.launch).toHaveBeenCalledTimes(maxRetries);

        // Verify that browser.close was called exactly maxRetries times (once per failed attempt)
        expect(mockBrowser.close).toHaveBeenCalledTimes(maxRetries);
    });
});

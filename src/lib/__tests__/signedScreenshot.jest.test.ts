import { signScreenshotPath, requireSignedScreenshot } from '../signedScreenshot';

function run(url: string) {
    const u = new URL(url, 'http://x');
    const req: any = { path: u.pathname.replace(/^\/screenshots/, ''), query: Object.fromEntries(u.searchParams) };
    const res: any = { status: jest.fn(() => res), end: jest.fn() };
    const next = jest.fn();
    requireSignedScreenshot(req, res, next);
    return { res, next };
}

describe('signed screenshot links', () => {
    it('lets a fresh signed link through', () => {
        const { next } = run(signScreenshotPath('/screenshots/acme_com_1.png')!);
        expect(next).toHaveBeenCalled();
    });

    it('blocks a link with no signature', () => {
        const { res, next } = run('/screenshots/acme_com_1.png');
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks a signature reused for another file', () => {
        const signed = signScreenshotPath('/screenshots/acme_com_1.png')!;
        const { res, next } = run(signed.replace('acme_com_1', 'other_com_2'));
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('blocks an expired link', () => {
        const old = signScreenshotPath('/screenshots/acme_com_1.png', Date.now() - 3600_000)!;
        const { res, next } = run(old);
        expect(res.status).toHaveBeenCalledWith(403);
        expect(next).not.toHaveBeenCalled();
    });

    it('returns null when there is no screenshot', () => {
        expect(signScreenshotPath(null)).toBeNull();
    });
});

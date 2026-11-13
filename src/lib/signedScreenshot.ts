import crypto from 'crypto';
import path from 'path';
import { Request, Response, NextFunction } from 'express';
import { getHmacSecret } from './secrets';

const TTL_SEC = 600; // links live 10 minutes

function sign(file: string, exp: number): string {
    return crypto
        .createHmac('sha256', getHmacSecret('screenshot url signing'))
        .update(`screenshot:${file}:${exp}`)
        .digest('hex');
}

/** Turns a stored "/screenshots/<file>" path into a short-lived signed URL path. */
export function signScreenshotPath(stored: string | null | undefined, nowMs: number = Date.now()): string | null {
    if (!stored) return null;
    const file = path.posix.basename(stored);
    const exp = Math.floor(nowMs / 1000) + TTL_SEC;
    return `/screenshots/${encodeURIComponent(file)}?exp=${exp}&sig=${sign(file, exp)}`;
}

/** Guards the /screenshots static mount: only unexpired links signed by this server pass. */
export function requireSignedScreenshot(req: Request, res: Response, next: NextFunction) {
    let file: string;
    try {
        file = path.posix.basename(decodeURIComponent(req.path));
    } catch {
        return res.status(403).end();
    }
    const exp = Number(req.query.exp);
    const sig = typeof req.query.sig === 'string' ? req.query.sig : '';
    if (!Number.isInteger(exp) || exp * 1000 < Date.now()) {
        return res.status(403).end();
    }
    const expected = Buffer.from(sign(file, exp));
    const given = Buffer.from(sig);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
        return res.status(403).end();
    }
    next();
}

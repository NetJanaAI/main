import * as Sentry from "@sentry/node";

/**
 * Secure Logger
 * Intercepts logs and redacts PII to prevent leaks without crashing the process.
 */

// Regex from Sovereign Firewall
const PII_REGEX = {
    EMAIL: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    PHONE: /(?:\+|00)[1-9][0-9 \-\.]{6,14}[0-9]/g,
};

function maskPII(input: any): any {
    if (typeof input === 'string') {
        let redacted = input;
        redacted = redacted.replace(PII_REGEX.EMAIL, '[REDACTED_EMAIL]');
        redacted = redacted.replace(PII_REGEX.PHONE, '[REDACTED_PHONE]');
        return redacted;
    } else if (typeof input === 'object' && input !== null) {
        try {
            let json = JSON.stringify(input);
            const originalJson = json;
            json = json.replace(PII_REGEX.EMAIL, '[REDACTED_EMAIL]');
            json = json.replace(PII_REGEX.PHONE, '[REDACTED_PHONE]');

            if (json !== originalJson) {
                return JSON.parse(json);
            }
        } catch (e) {
            return '[REDACTION_FAILURE]';
        }
    }
    return input;
}

const originalLog = console.log;
const originalWarn = console.warn;
const originalError = console.error;

export const SecureLogger = {
    maskPII,
    init: () => {
        console.log = (...args: any[]) => {
            const safeArgs = args.map(arg => maskPII(arg));
            originalLog.apply(console, safeArgs);
        };

        console.warn = (...args: any[]) => {
            const safeArgs = args.map(arg => maskPII(arg));
            originalWarn.apply(console, safeArgs);
        };

        console.error = (...args: any[]) => {
            const safeArgs = args.map(arg => maskPII(arg));
            
            // Forward error objects to Sentry
            safeArgs.forEach(arg => {
                if (arg instanceof Error) Sentry.captureException(arg);
                else if (typeof arg === 'string') Sentry.captureMessage(arg, 'error');
            });
            
            originalError.apply(console, safeArgs);
        };

        originalLog('[SecureLogger] Strict Logging Filter Attached. PII leaks will be automatically redacted.');
    }
};

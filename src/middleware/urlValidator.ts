import { promises as dns } from 'dns';
import ip from 'ip';

/**
 * Validates a target URL against strict security policies:
 * 1. Must use HTTPS scheme.
 * 2. Hostname must resolve to a public IP.
 * 3. IP must NOT be in private ranges (RFC1918), loopback, or cloud metadata.
 */
export async function validateTargetUrl(targetUrl: string): Promise<{ isValid: boolean; error?: string; resolvedIp?: string }> {
    try {
        const url = new URL(targetUrl);

        // 1. Strict Scheme Check
        if (url.protocol !== 'https:') {
            return { isValid: false, error: 'Only HTTPS scheme is allowed.' };
        }

        const hostname = url.hostname;

        // 2. DNS Resolution
        const addresses = await dns.resolve4(hostname);
        if (addresses.length === 0) {
            return { isValid: false, error: 'Could not resolve hostname.' };
        }

        const resolvedIp = addresses[0];

        // 3. SSRF Checks (Private/Loopback/Metadata)
        if (ip.isPrivate(resolvedIp)) {
            return { isValid: false, error: `Blocked Private IP: ${resolvedIp}` };
        }

        if (ip.isLoopback(resolvedIp)) {
            return { isValid: false, error: `Blocked Loopback IP: ${resolvedIp}` };
        }

        // Link-Local (169.254.x.x) - specifically cloud metadata
        if (ip.cidrSubnet('169.254.0.0/16').contains(resolvedIp)) {
            return { isValid: false, error: `Blocked Cloud Metadata IP: ${resolvedIp}` };
        }

        return { isValid: true, resolvedIp };

    } catch (error: any) {
        return { isValid: false, error: `URL Validation Error: ${error.message}` };
    }
}

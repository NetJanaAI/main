import axios from 'axios';

export interface ProxyConfig {
    host: string;
    port: number;
    username?: string;
    password?: string;
    protocol: 'http' | 'https';
    region?: string;
}

export class ProxyManager {
    private static BRIGHT_DATA_URL = process.env.BRIGHT_DATA_URL; // Super proxy URL
    private static OXYLABS_URL = process.env.OXYLABS_URL;
    private static REGION_OVERRIDE = process.env.REGION_ID;

    /**
     * Returns a region-optimized proxy configuration for Playwright.
     * Supports dynamic country targeting via Bright Data/Oxylabs session strings.
     */
    static getProxyForRegion(targetUrl: string, requestedRegion?: string): ProxyConfig | null {
        const region = requestedRegion || this.detectRegion(targetUrl) || this.REGION_OVERRIDE || 'US';
        
        // If Bright Data is configured, return a session-linked super proxy
        if (this.BRIGHT_DATA_URL) {
            const url = new URL(this.BRIGHT_DATA_URL);
            // Append country targeting to username if using Bright Data standard: user-zone-ZONE-country-COUNTRY
            // This is a common pattern for residential proxies
            return {
                host: url.hostname,
                port: parseInt(url.port),
                username: `${url.username}-country-${region.toLowerCase()}`,
                password: url.password,
                protocol: url.protocol.replace(':', '') as 'http' | 'https',
                region
            };
        }

        // Graceful fallback: return null to use local host IP if no residential proxy is configured.
        if (process.env.NODE_ENV === 'development') {
            return null; // Return null to use local IP in dev unless forced
        }

        return null;
    }

    /**
     * Heuristic to detect appropriate region based on TLD or known domain mapping.
     */
    private static detectRegion(url: string): string | null {
        try {
            const domain = new URL(url).hostname;
            if (domain.endsWith('.in')) return 'IN';
            if (domain.endsWith('.ae')) return 'AE';
            if (domain.endsWith('.de')) return 'DE';
            if (domain.endsWith('.uk')) return 'GB';
            if (domain.endsWith('.fr')) return 'FR';
            if (domain.endsWith('.au')) return 'AU';
            return null;
        } catch {
            return null;
        }
    }

    /**
     * Checks proxy health by attempting a small request through it.
     */
    static async checkHealth(config: ProxyConfig): Promise<boolean> {
        try {
            const proxyAuth = config.username ? `${config.username}:${config.password}@` : '';
            const proxyUrl = `${config.protocol}://${proxyAuth}${config.host}:${config.port}`;
            
            await axios.get('https://api.ipify.org?format=json', {
                proxy: {
                    protocol: config.protocol,
                    host: config.host,
                    port: config.port,
                    auth: config.username ? { username: config.username, password: config.password! } : undefined
                },
                timeout: 5000
            });
            return true;
        } catch (e) {
            console.error(`[ProxyManager] Health check failed for ${config.region}:`, (e as Error).message);
            return false;
        }
    }
}

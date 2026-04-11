const USER_AGENTS = [
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4_1) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36'
];

export const getRandomUserAgent = (): string => {
    const base = USER_AGENTS[Math.floor(Math.random() * USER_AGENTS.length)];
    // Add small randomized version variation to spoof niche browser builds
    const minorVer = Math.floor(Math.random() * 10);
    const patchVer = Math.floor(Math.random() * 100);
    return base.replace(/\d+\./, (match) => `${parseInt(match) + minorVer}.0.${patchVer}.`);
};


export const stealthScripts = [
    () => {
        Object.defineProperty(navigator, 'webdriver', {
            get: () => false,
        });
    },
    () => {
        (window as any).chrome = {
            runtime: {},
        };
    },
    () => {
        const originalQuery = window.navigator.permissions.query;
        window.navigator.permissions.query = (parameters) => (
            parameters.name === 'notifications' ?
                Promise.resolve({ state: Notification.permission } as any) :
                originalQuery(parameters)
        );
    },
    // Canvas Fingerprinting Defense: Inject tiny noise into toDataURL
    () => {
        const originalToDataURL = HTMLCanvasElement.prototype.toDataURL;
        HTMLCanvasElement.prototype.toDataURL = function (type) {
            const res = originalToDataURL.apply(this, arguments as any);
            // Just slightly modify the result string for non-empty signatures
            return res.length > 10 ? res + '0' : res;
        };
    },
    // WebGL Fingerprinting Defense
    () => {
        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function (parameter) {
            // Spoof some common WebGL parameters used for fingerprinting
            if (parameter === 37445) return 'Intel Open Source Technology Center'; 
            if (parameter === 37446) return 'Mesa DRI Intel(R) HD Graphics 620 (Kaby Lake GT2)';
            return getParameter.apply(this, arguments as any);
        };
    }
];

export type NetjanaMode = 'covospan' | 'standalone';

let mode = (process.env.NETJANA_MODE as NetjanaMode) || 'standalone';

if (mode !== 'covospan' && mode !== 'standalone') {
    console.warn(`[Config] Invalid NETJANA_MODE '${mode}'. Defaulting to 'standalone'.`);
    mode = 'standalone';
}

export const NETJANA_MODE: NetjanaMode = mode;
export const IS_COVOSPAN = mode === 'covospan';
export const IS_STANDALONE = mode === 'standalone';

console.log(`[Config] NetJana initialized in ${mode.toUpperCase()} mode.`);

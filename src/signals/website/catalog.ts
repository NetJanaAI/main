export const SIGNAL_KEYS = [
    'no_online_booking',
    'running_ads',
    'no_structured_data',
    'blog_stale',
    'blocks_ai_crawlers',
    'tech_stack',
    'hiring_open_roles',
    'has_contact_form',
    'self_stated_funding',
] as const;

export type SignalKey = (typeof SIGNAL_KEYS)[number];

export interface SignalDefinition {
    key: SignalKey;
    label: string;
    description: string;
    /** Every signal is read from the company's own public pages, so none costs anything. */
    cost: 'free';
    /** What value.number means for range filters, when the signal has one. */
    numeric?: string;
}

export const CATALOG: SignalDefinition[] = [
    { key: 'no_online_booking', label: 'No online booking', description: 'The homepage has no booking or scheduling tool, so customers must call.', cost: 'free' },
    { key: 'running_ads', label: 'Running ads', description: 'Google, Meta, LinkedIn or TikTok advertising tags are present on the homepage.', cost: 'free' },
    { key: 'no_structured_data', label: 'No structured data', description: 'The homepage carries no schema.org markup.', cost: 'free' },
    { key: 'blog_stale', label: 'Stale blog', description: 'The newest dated blog post is older than 12 months.', cost: 'free', numeric: 'months since the last post' },
    { key: 'blocks_ai_crawlers', label: 'Blocks AI crawlers', description: 'robots.txt disallows known AI crawlers.', cost: 'free', numeric: 'number of AI crawlers blocked' },
    { key: 'tech_stack', label: 'Tech stack', description: 'Website platform and marketing tools detected in the homepage source.', cost: 'free', numeric: 'number of technologies detected' },
    { key: 'hiring_open_roles', label: 'Hiring for target roles', description: 'The site links a public Greenhouse, Lever, Ashby or Workable board with open roles matching your target roles.', cost: 'free', numeric: 'number of matching open roles' },
    { key: 'has_contact_form', label: 'Has a contact form', description: 'The homepage has a contact form or links to a contact page.', cost: 'free' },
    { key: 'self_stated_funding', label: 'Self-stated funding or accelerator', description: 'The company\'s own site names an accelerator or a funding round.', cost: 'free' },
];

export function isSignalKey(value: string): value is SignalKey {
    return (SIGNAL_KEYS as readonly string[]).includes(value);
}

/** One observation of one signal for one company. present=false means "checked, and not there". */
export interface SignalValue {
    present: boolean;
    number?: number;
    detail?: Record<string, unknown>;
}

export interface Observation {
    key: SignalKey;
    value: SignalValue;
    evidenceUrl: string;
}

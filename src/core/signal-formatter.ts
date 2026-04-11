/**
 * @deprecated Legacy Signal Formatter
 * Prepares raw payloads into structured facts for better LLM reasoning.
 * Superceded by native JSON-to-TOON block injection in gemini-chain.ts
 */

export function formatSignalForGemini(
    sourceId: string,
    payload: Record<string, any>
): string {
    const formatter = FORMATTERS[sourceId];
    if (!formatter) {
        return genericFormatter(payload);
    }
    return formatter(payload);
}

function formatIndiaMART(p: Record<string, any>): string {
    const lines: string[] = [];
    if (p.query_message || p.QUERY_MESSAGE) {
        lines.push(`BUYER SAID: "${(p.query_message || p.QUERY_MESSAGE).slice(0, 200)}"`);
    }

    const msg = (p.query_message || p.QUERY_MESSAGE || '');
    const qtyMatch = msg.match(
        /(\d[\d,]*\.?\d*)\s*(kg|mt|ton|tonne|piece|pcs|unit|nos|ltr|litre|meter|mtr|feet|ft|box|bag|roll)/gi
    );
    if (qtyMatch) lines.push(`QUANTITY MENTIONED: ${qtyMatch.join(', ')}`);

    const budgetMatch = msg.match(
        /(?:budget|price|rate|cost|₹|rs\.?|inr)\s*[:\s]?\s*(\d[\d,]*(?:\s*(?:lakh|lac|crore|k|l|cr))?)/gi
    );
    if (budgetMatch) lines.push(`BUDGET SIGNAL: ${budgetMatch.join(', ')}`);

    const timeMatch = msg.match(/(\d+)\s*(day|week|month|hour)s?/gi);
    const urgencyWords = ['urgent', 'asap', 'immediately', 'jaldi', 'turant'];
    const hasUrgency = urgencyWords.some(w => msg.toLowerCase().includes(w));
    if (timeMatch || hasUrgency) lines.push(`TIMELINE: ${timeMatch?.join(', ') || 'URGENT (explicit)'}`);

    lines.push(`PRODUCT CATEGORY: ${p.query_product_name || p.PRODUCT_CATEGORY || 'Not categorised'}`);
    lines.push(`BUYER LOCATION: ${p.sender_city || p.CITY || 'Unknown'}, ${p.sender_state || p.STATE || 'Unknown'}`);
    lines.push(`RFQ POSTED: ${formatTimestamp(p.query_time || p.QUERY_TIME)}`);

    if (p.call_duration || p.CALL_DURATION) {
        const dur = parseInt(p.call_duration || p.CALL_DURATION || '0');
        if (dur > 0) lines.push(`ENGAGEMENT: Buyer called before posting (${dur}s) — high intent`);
    }

    return lines.filter(Boolean).join('\n');
}

function formatGeM(p: Record<string, any>): string {
    const lines: string[] = [];
    lines.push(`TENDER ID: ${p.bid_id}`);
    lines.push(`CATEGORY: ${p.item_category || p.category}`);
    lines.push(`MINISTRY/DEPT: ${p.ministry_state || p.ministry_dept || 'Not specified'}`);

    const val = p.estimated_value_inr || p.estimated_value;
    if (val) lines.push(`ESTIMATED VALUE: ${formatIndianCurrency(val)}`);

    const deadline = p.bid_deadline;
    if (deadline) {
        const dDate = new Date(deadline);
        const daysLeft = Math.ceil((dDate.getTime() - Date.now()) / 86400000);
        lines.push(`BID DEADLINE: ${deadline} (${daysLeft} days remaining)`);
        if (daysLeft <= 3) lines.push(`⚠ CRITICAL: Less than 3 days to deadline`);
    }

    lines.push(`LOCATION: ${p.location_state || 'All India'}`);
    if (p.is_msme_reserved) lines.push(`MSME RESERVED: Yes — EMD waiver applicable`);
    if (p.quantity) lines.push(`QUANTITY: ${p.quantity} ${p.unit || ''}`);

    return lines.filter(Boolean).join('\n');
}

function formatMCA(p: Record<string, any>): string {
    const lines: string[] = [];
    lines.push(`EVENT: ${p.event_type || 'Capital/Director Change'}`);
    lines.push(`CIN: ${p.cin}`);

    if (p.paid_up_capital_before && p.paid_up_capital_after) {
        const before = formatIndianCurrency(p.paid_up_capital_before);
        const after = formatIndianCurrency(p.paid_up_capital_after);
        const increase = Math.round((p.paid_up_capital_after - p.paid_up_capital_before) / p.paid_up_capital_before * 100);
        lines.push(`CAPITAL CHANGE: ${before} → ${after} (+${increase}%)`);
    }

    if (p.new_director_name) {
        lines.push(`NEW DIRECTOR: ${p.new_director_name} (DIN: ${p.new_director_din})`);
    }

    lines.push(`EVENT DATE: ${p.event_date}`);
    lines.push(`STATE: ${p.state}`);

    return lines.filter(Boolean).join('\n');
}

function formatNaukri(p: Record<string, any>): string {
    const lines: string[] = [];
    lines.push(`JOB TITLE: ${p.job_title}`);
    lines.push(`COMPANY: ${p.company_name}`);
    lines.push(`LOCATION: ${p.job_location || p.location_city}`);
    lines.push(`POSTED: ${formatTimestamp(p.posted_date)}`);

    if (p.salary_range) lines.push(`SALARY RANGE: ${p.salary_range}`);

    const intentSentences = extractIntentSentences(p.job_description);
    if (intentSentences.length > 0) {
        lines.push(`KEY JD EXCERPTS:`);
        intentSentences.forEach(s => lines.push(`  • ${s}`));
    }

    return lines.filter(Boolean).join('\n');
}

function formatZauba(p: Record<string, any>): string {
    const lines: string[] = [];
    lines.push(`IMPORTER: ${p.company_name || p.importer_name}`);
    lines.push(`PRODUCT: ${p.import_item || p.product_description}`);
    if (p.import_value || p.shipment_value_inr) {
        lines.push(`SHIPMENT VALUE: ${formatIndianCurrency(parseFloat(p.import_value || p.shipment_value_inr))}`);
    }
    lines.push(`PORT: ${p.port_of_unloading || p.port_of_entry}`);

    if (p.spike_type) {
        lines.push(`SIGNAL TYPE: ${p.spike_type}`);
    }

    return lines.filter(Boolean).join('\n');
}

function formatFunding(p: Record<string, any>): string {
    const lines: string[] = [];
    lines.push(`COMPANY: ${p.company_name}`);
    lines.push(`ROUND: ${p.funding_round || p.round_type}`);

    const amt = p.funding_amount || p.funding_amount_usd;
    if (amt) {
        lines.push(`AMOUNT: ${amt}`);
    }

    if (p.use_of_funds) {
        lines.push(`USE OF FUNDS STATED: "${p.use_of_funds}"`);
    }

    return lines.filter(Boolean).join('\n');
}

function genericFormatter(p: Record<string, any>): string {
    const facts: string[] = [];
    const json = JSON.stringify(p);
    const numberMatches = json.match(/"[^"]+"\s*:\s*(\d[\d,]*(?:\.\d+)?)/g);
    numberMatches?.slice(0, 5).forEach(m => {
        const [key, val] = m.split(':');
        facts.push(`${key.replace(/"/g, '').trim()}: ${val.trim()}`);
    });

    Object.entries(p).forEach(([k, v]) => {
        if (typeof v === 'string' && v.length < 100 && v.length > 3) {
            facts.push(`${k.toUpperCase()}: ${v}`);
        }
    });

    return facts.slice(0, 10).join('\n');
}

function extractIntentSentences(jd: string): string[] {
    if (!jd) return [];
    const INTENT_PATTERNS = [
        /manage\s+(?:vendor|supplier|procurement)/gi,
        /(?:source|procure|purchase|buy)\s+\w+/gi,
        /(?:negotiate|evaluate)\s+(?:vendor|supplier|contract)/gi,
        /(?:erp|sap|oracle)\s+(?:implementation|rollout|migration)/gi,
    ];
    const sentences = jd.split(/[.!?]+/);
    return sentences
        .filter(s => INTENT_PATTERNS.some(p => p.test(s)))
        .map(s => s.trim().slice(0, 100))
        .slice(0, 3);
}

function formatIndianCurrency(amount: any): string {
    const n = parseFloat(String(amount).replace(/[^0-9.]/g, ''));
    if (isNaN(n)) return String(amount);
    if (n >= 10000000) return `₹${(n / 10000000).toFixed(1)} Cr`;
    if (n >= 100000) return `₹${(n / 100000).toFixed(1)} L`;
    if (n >= 1000) return `₹${(n / 1000).toFixed(0)}K`;
    return `₹${n}`;
}

function formatTimestamp(ts: string): string {
    if (!ts) return 'Unknown';
    try {
        const d = new Date(ts);
        const now = new Date();
        const hoursAgo = Math.round((now.getTime() - d.getTime()) / 3600000);
        if (hoursAgo < 24) return `${hoursAgo}h ago`;
        return `${Math.round(hoursAgo / 24)}d ago`;
    } catch {
        return ts;
    }
}

const FORMATTERS: Record<string, (p: Record<string, any>) => string> = {
    indiamart: formatIndiaMART,
    gem: formatGeM,
    mca: formatMCA,
    naukri: formatNaukri,
    zauba: formatZauba,
    funding: formatFunding,
};

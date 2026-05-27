import axios from 'axios';
import { GeMCollectorPayload } from '../../lib/schemas';

// Simple regex-based XML parser for GeM feeds since we don't have xml2js installed
function parseGeMXML(xmlString: string): GeMCollectorPayload[] {
    const items: GeMCollectorPayload[] = [];
    const itemRegex = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemRegex.exec(xmlString)) !== null) {
        const itemXml = match[1];
        
        const extract = (tag: string) => {
            const startTag = `<${tag}>`;
            const endTag = `</${tag}>`;
            const startIndex = itemXml.indexOf(startTag);
            if (startIndex === -1) return '';
            const endIndex = itemXml.indexOf(endTag, startIndex + startTag.length);
            if (endIndex === -1) return '';
            const m = itemXml.substring(startIndex + startTag.length, endIndex);
            return m.trim().replace(/<!\[CDATA\[(.*?)\]\]>/g, '$1');
        };

        const bidId = extract('bid_id') || extract('title');
        if (!bidId) continue;

        items.push({
            bid_id: bidId,
            buyer_name: extract('buyer_name') || extract('department') || 'Unknown Buyer',
            ministry_state: extract('ministry_state') || 'Unknown State',
            department: extract('department') || 'Unknown Department',
            bid_deadline: extract('bid_deadline') || extract('pubDate') || new Date().toISOString(),
            item_category: extract('item_category') || extract('description') || 'General Category',
            quantity: parseInt(extract('quantity') || '1', 10),
        });
    }

    return items;
}

export async function fetchGeMXMLFeed(feedUrl: string): Promise<GeMCollectorPayload[]> {
    try {
        const response = await axios.get(feedUrl, { timeout: 15000 });
        const xml = response.data;
        return parseGeMXML(xml);
    } catch (e: any) {
        console.error(`[GeM Collector] Failed to fetch feed ${feedUrl}:`, e.message);
        return [];
    }
}

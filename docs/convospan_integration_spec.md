# ConvoSpan Intelligence Integration Specification
**Version:** 1.0.0  
**Source:** NetJana.AI / B2B Scraper (Intel Engine)  
**Target:** ConvoSpan Main Platform (Campaign Orchestrator)

## 1. Overview
The B2B Scraper (Intel Engine) acts as a high-fidelity intent sensor. When it identifies a prospective buyer (Lead Card), it pushes the signal to ConvoSpan via a secure webhook. ConvoSpan should ingest these signals to trigger automated outreach or optimize existing campaigns.

## 2. Connectivity & Security

### 2.1 Webhook Endpoint
ConvoSpan must expose a public POST endpoint to receive these signals.
- **Recommended Path:** `POST /api/webhooks/netjana-intel`
- **Method:** `POST`
- **Content-Type:** `application/json`

### 2.2 Header-Based Authentication
The B2B Scraper sends the following headers with every request:

| Header | Description | Required |
| --- | --- | --- |
| `x-api-key` | A static API Key provided by ConvoSpan to identify the request. | **Yes** |
| `x-source` | Always set to `netjana-intel`. | **Yes** |
| `x-netjana-signature` | HMAC-SHA256 hash of the request body, signed with a shared secret. | **Optional** (Highly Recommended) |

### 2.3 HMAC Signature Verification (Security Block)
If an `HMAC_SECRET` is configured in the B2B Scraper Sync Node, ConvoSpan **must** verify the signature to ensure authenticity and prevent tampering.

**Verification Logic (Node.js Example):**
```javascript
const crypto = require('crypto');

function verifySignature(req, secret) {
    const signature = req.headers['x-netjana-signature'];
    const body = JSON.stringify(req.body);
    const expected = crypto.createHmac('sha256', secret).update(body).digest('hex');
    return crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
}
```

## 3. Data Schema (JSON)

### 3.1 Push Payload Structure
The top-level object wrapper.

| Field | Type | Description |
| --- | --- | --- |
| `event` | `string` | Type of event. Usually `LEAD_CARD_READY`. |
| `source` | `string` | Identification of the source engine. |
| `timestamp` | `ISO-8601` | Time the signal was transmitted. |
| `lead` | `object` | The core intelligence document (see 3.2). |
| `campaign_id` | `string?` | Optional routing ID to map this signal to a specific ConvoSpan campaign. |
| `meta` | `object` | Telemetry metadata (`pushed_by`, `retry_attempt`). |

### 3.2 Lead Card Attributes
This is the "Alpha" data point.

| Field | Description |
| --- | --- |
| `lead_id` | Unique UUID of the lead document. |
| `company_name` | Canonical name of the identified buying organization. |
| `intent_score` | 0-100 score of interest (High > 80, Medium > 60). |
| `buying_stage` | Detected stage: `AWARENESS`, `CONSIDERATION`, `DECISION`. |
| `card_why_now` | The narrative justification for the intent (The "Alpha"). |
| `card_what_they_need` | Specific procurement requirement identified. |
| `card_do_this` | Recommended outreach strategy. |
| `verity_tier` | Confidence level of the signal (`TIER_1` = Confirmed, `TIER_2` = Statistical). |
| `is_triangulated` | True if intent is confirmed across multiple independent platforms. |

## 4. Example Payload
```json
{
  "event": "LEAD_CARD_READY",
  "source": "NetJana.AI / ConvoSpan Intel",
  "timestamp": "2026-04-04T08:42:00Z",
  "lead": {
    "lead_id": "b7e452a1-cf56-4b88-9d22-12a8934520bc",
    "company_name": "Modern Logistics Solutions Ltd",
    "geo_state": "Maharashtra",
    "sector": "Logistics & Supply Chain",
    "source_id": "indiamart",
    "buying_stage": "CONSIDERATION",
    "procurement_category": "Warehouse Management Software",
    "intent_score": 88,
    "verity_tier": "TIER_1",
    "is_triangulated": true,
    "card_why_now": "Recently posted 3 urgent warehouse software requirements and expanded operations in Navi Mumbai.",
    "card_what_they_need": "Real-time inventory tracking for 50k sq ft facility.",
    "card_do_this": "Connect with Head of Operations; offer the Enterprise WMS trial.",
    "created_at": "2026-04-04T08:40:15Z"
  },
  "campaign_id": "camp_logistic_2026",
  "meta": {
    "pushed_by": "auto"
  }
}
```

## 5. Integration Workflow
1. **Configure Sync Node:** In the B2B Scraper Dashboard -> **Sync Node**, enter your ConvoSpan endpoint, API Key, and Secret.
2. **Test Connectivity:** Click **Test Connection** to send a heartbeat packet.
3. **Handle Idempotency:** ConvoSpan should use the `lead_id` to prevent duplicate campaign entries if a signal is re-pushed.
4. **Resilience:** The B2B Scraper will retry failed pushes (Status code != 200) up to 3 times with exponential backoff.

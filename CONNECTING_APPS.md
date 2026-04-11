# Steps to Connect NetJana.AI to ConvoSpan
This guide outlines the protocol to link the **NetJana.AI Intel Engine** (source) to the **ConvoSpan Main Application** (target) for automated lead signal propagation.

## Phase 1: Target Preparation (ConvoSpan Side)
Before configuring the connection, the ConvoSpan team must perform the following:
1.  **Define Ingest Route:** Provision a public endpoint (e.g., `POST /api/webhooks/netjana-intel`).
2.  **Generate API Key:** Create a static key/token for the B2B Scraper to use (`x-api-key`). 
    - *Example:* `sk_convospan_2026_x123`
3.  **Define HMAC Secret (Optional):** Create a shared secret key for SHA-256 payload signing.
    - *Example:* `netjana_hmac_secret_456`
4.  **Schema Alignment:** Provide the `docs/covospan_signal_schema.json` to the **AI Codex** to auto-generate the ingestion and validation logic.

## Phase 2: Configuration (NetJana.AI Side)
Once Phase 1 is complete, navigate to the **B2B Scraper Terminal**:
1.  **Go to Sync Node:** Open the **Sync Node** page from the sidebar navigation.
2.  **Configure Cluster:**
    - **Endpoint URL:** `https://your-convospan-domain.com/api/webhooks/netjana-intel`
    - **API Cluster Key:** Pasteur the API key from ConvoSpan.
    - **HMAC Secret:** Pasteur the HMAC secret.
    - **Campaign ID:** Optional. Use this to route all signals from this NetJana node to a specific ConvoSpan campaign.
3.  **Save Config:** Establish the link.

## Phase 3: Connectivity Testing
1.  **Ping Test:** On the **Sync Node** page, click **Test Connectivity**.
    - This sends a minimalist `LEAD_CARD_READY` packet with mock data.
    - Verify your ConvoSpan logs show an `HTTP 200` response.
2.  **Telemetry Audit:** Monitor the **Signal Push Telemetry** table. Each signal should show a "SUCCESS" status.
3.  **Manual Re-Push:** If an initial signal fails due to a network dropout, use the **RE-RE-PUSH** button in the telemetry log to trigger a retry.

## Protocol Security Check
ConvoSpan should use the `x-netjana-signature` header to verify the SHA-256 HMAC of the request body. If the signature doesn't match, the request should be rejected to prevent ingestion of phantom signals.

### Authentication Headers:
- `x-api-key`: `YOUR_API_KEY`
- `x-source`: `netjana-intel`
- `x-netjana-signature`: `HMAC_SHA256_HASH`

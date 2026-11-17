# Connecting NetJana: keys, CraftMyFunnel, and signal sources

NetJana delivers buyer signals only. It holds no company database. There are three ways data moves in and out of your workspace. The same notes appear in the app (the plug icon at the top right, and the last step of setup).

## 1. Your API key

- One key per workspace. Send it as `x-api-key` on pull and ingest requests.
- Treat it like a password. Do not paste it into chat, tickets or code. If it leaks, rotate it.

## 2. CraftMyFunnel

Signals push to **your own** CraftMyFunnel workspace. There is no shared workspace.

**Connect:** App > API Manager > CraftMyFunnel Signal Link. Enter the workspace URL, API key and signing secret. Org admins only. The key and secret are stored encrypted; afterwards only the last 4 characters of the key are shown. The URL must be a public `https` address.

**Catch up after a missed push:**

```
GET /v1/intel/leads?since=<ISO-8601>&limit=<1-200>&cursor=<opaque>
x-api-key: <your key>
```

- Oldest first. Follow `next_cursor` until it is `null`.
- Signals only (company, sector, region, stage, score, why now, what they need, next step). No contact details are returned.
- Rate limited to 60 requests per minute per key.
- One lead: `GET /v1/intel/leads/{lead_id}`.

**Operators:** the global `CRAFTMYFUNNEL_*` env vars apply only to tenant ids listed in `CRAFTMYFUNNEL_ENV_FALLBACK_ORGS`, and every use is logged.

## 3. Other websites feeding signals

Approved sources post buyer signals to your workspace over HTTPS:

```
POST /api/ingest/{source}
x-api-key: <your key>
x-source-signature: <HMAC-SHA256 of the raw body>   # when signing is enabled
```

Sources: `gem`, `indiamart`, `funding`, `naukri`, `zauba`, `mca`, `parivesh`, `rera`. The sending server's IP must be on your allowlist.

# ConvoSpan Intel — Government Registry Intelligence Layer

> *The only B2B intelligence platform that triangulates India & UAE government registries to surface verified, time-bounded buying intent — before companies issue an RFP.*

Zero scraping of private websites. 100% legally sourced data. Compliance-first by architecture.

---

## 🌐 Data Sources

| Source | Country | Tier | Type |
|---|---|---|---|
| **MCA21** | 🇮🇳 India | Tier 1 | Corporate filings, capital events, new incorporations |
| **GeM Portal** | 🇮🇳 India | Tier 1 | Live government tenders with deadlines |
| **RERA** | 🇮🇳 India | Tier 2 | Project approvals, construction milestones |
| **DGFT** | 🇮🇳 India | Tier 2 | Import spike data, IEC code changes |
| **Naukri** | 🇮🇳 India | Tier 3 | Procurement/supply chain hiring surges |
| **Zauba** | 🇮🇳 India | Tier 2 | Import/export manifest signals |
| **Parivesh** | 🇮🇳 India | Tier 2 | Environmental clearance for large projects |
| **IndiaMART** | 🇮🇳 India | Tier 2 | Direct B2B buyer intent queries (webhook) |
| **DMCC** | 🇦🇪 UAE | Tier 1 | Dubai free zone entity registrations & licenses |
| **ADGM** | 🇦🇪 UAE | Tier 1 | Abu Dhabi financial free zone registrations |
| **Etimad** | 🇦🇪 UAE | Tier 1 | UAE federal government procurement tenders |
| **Zawya** | 🇦🇪 UAE | Tier 2 | UAE business news & deal intelligence |
| **Gulf News** | 🇦🇪 UAE | Tier 3 | Regional business event context |

---

## 🏛️ Core Features

- **Dual-Mode Operation**:
  - **Standalone (SaaS)**: Public-facing freemium cockpit with usage gating and HMAC-signed share links
  - **Covospan (Institutional)**: Multi-tenant private node with MCP tool integration and Sovereign Firewalling
- **Multi-Agent Intelligence Chain**: Gate → Qualify → Synthesize pipeline using TOON-optimized prompts
- **Durable Entity Registry**: Postgres-backed org index with phonetic resolution (Double Metaphone) and merge history
- **Intent Decay Scoring**: Mathematical half-life scoring (`I(t) = I₀ × e^(-λt)`) for signal freshness
- **TurboQuant RAG**: 8x vector memory compression in the Tenant RAG Store using 8-bit scalar quantization
- **TOON Prompt Optimization**: Token-Oriented Object Notation reduces LLM API spend by ~30% per inference chain
- **Adversarial AI Critic**: Two-agent Advocate/Critic reflection loop for signal quality assurance
- **Outreach Automation**: BullMQ-backed generation pipeline with real Nodemailer SMTP dispatch
- **ROI Intelligence Engine**: HMAC-signed PDF performance reports with verifiable pipeline value
- **Razorpay Billing**: Seat management, metered billing, and GST-compliant invoicing

---

## 🏗️ System Architecture

```mermaid
graph TD
    subgraph "Frontend – Institutional UI"
        UI[React 19 + Vite Dashboard]
        WS[Socket.IO Live Telemetry]
    end

    subgraph "API Gateway"
        API[Express API + ModeGuard]
        INGEST[/api/ingest/* — Webhook Endpoints/]
        ADMIN[/api/admin — Registry Admin/]
    end

    subgraph "AI Agent Chain"
        ROUTER[Signal Router]
        T1[Tier 1 Worker — Direct Badge]
        T2[Tier 2 Worker — Gate + Qualify + Write]
        T3[Tier 3 Worker — Enrichment Pool]
        CRITIC[Adversarial Critic — Advocate/Critic Loop]
        OUTREACH[Outreach Generator — TOON + Influence Map]
    end

    subgraph "Intelligence Infrastructure"
        TOON[TOON Serializer — Token Optimization]
        MODEL[ModelAPI — Gemini / Ollama / Fallback]
        RAG[TenantRAGStore — TurboQuant Compressed]
        KG[Knowledge Graph — Signal Context]
    end

    subgraph "Durable Storage"
        PG[(Postgres — Entity Registry + Audit)]
        UPSTASH[(Upstash Redis — Dedup + Spend Guard)]
        BULLMQ[BullMQ — Job Orchestration]
    end

    subgraph "Compliance & Security"
        FIREWALL[Sovereign Firewall — PII Masking]
        AUDIT[AuditTrail + RAGAuditLog]
        SENTINEL[Compliance Sentinel — GDPR/DPDP]
    end

    UI --> API
    API --> INGEST
    INGEST --> BULLMQ
    BULLMQ --> ROUTER
    ROUTER --> T1
    ROUTER --> T2
    ROUTER --> T3
    T2 --> TOON --> MODEL
    T2 --> CRITIC
    T2 --> RAG
    T2 --> KG
    MODEL --> Gemini[Gemini 1.5 Pro/Flash]
    T2 --> PG
    PG <--> UPSTASH
    T1 --> OUTREACH
    T2 --> FIREWALL --> AUDIT
```

---

## 🚀 Getting Started

### 1. Environment Variables

Create `.env` based on `.env.example`:

```bash
# Mode
MODE=standalone                         # or: covospan

# AI Provider
GOOGLE_API_KEY=your_gemini_key
ENABLE_TURBOQUANT=true                  # Vector compression (default: on)

# Storage
DATABASE_URL=postgresql://user:pass@host/db
UPSTASH_REDIS_REST_URL=https://xxx.upstash.io
UPSTASH_REDIS_REST_TOKEN=AXxx...

# Email Dispatch (Outreach)
SMTP_HOST=smtp.yourprovider.com
SMTP_PORT=587
SMTP_USER=your@email.com
SMTP_PASS=yourpassword
SMTP_FROM="ConvoSpan Sentinel <noreply@convospan.com>"

# Optional: Proxy
BRIGHT_DATA_URL=http://user:pass@brd.superproxy.io:22225
OLLAMA_HOST=http://localhost:11434       # Fallback LLM

# Commercialization
RAZORPAY_KEY_ID=rzp_live_xxx
RAZORPAY_KEY_SECRET=xxx
HMAC_SECRET=your_hmac_secret_here
BRAIN_WEBHOOK_URL=https://your-brain-endpoint
REGION_ID=IN                            # or: AE
```

### 2. Install & Run

```bash
npm install
npm run dev          # Starts API + UI dev server concurrently
```

### 3. Docker (Production)

```bash
docker-compose up --build
```

---

## 📁 Project Structure

```
src/
├── modes/
│   ├── standalone/      # SaaS cockpit entrypoint
│   └── covospan/        # Institutional node entrypoint
├── core/
│   ├── gemini-chain.ts  # Tier 1/2/3 BullMQ workers
│   ├── router.ts        # Signal routing logic
│   ├── entity-resolver.ts # Phonetic org resolution
│   ├── adapters.ts      # Source-specific payload normalization
│   ├── collectors/      # IndiaMART dedup + UAE adapters
│   ├── outreach/        # OutreachGenerator (TOON + ModelAPI)
│   ├── rag/             # TenantRAGStore (TurboQuant)
│   ├── toon/            # Influence injector
│   ├── compliance/      # AuditTrail + ComplianceMatrix
│   └── signals/         # Intent decay scoring
├── engines/
│   ├── AdversarialCritic.ts  # Advocate/Critic reflection loop
│   ├── b2bScraper.ts         # Legacy Playwright scraper engine
│   └── siteSpider.ts
├── lib/
│   ├── model-api.ts     # ModelAPI abstraction (Gemini/Ollama/Fallback)
│   ├── ai/toon.ts       # TOON serializer/parser
│   ├── cache.ts         # Upstash Redis client
│   ├── database.ts      # Postgres connection + schema
│   └── queue.ts         # BullMQ queue definitions
├── routes/
│   ├── ingest.ts        # Webhook ingestion endpoints (unprotected — TODO: add HMAC)
│   ├── leads.ts, results.ts, campaigns.ts ...
├── standalone/
│   └── services/        # CampaignROIAggregator, ROIPDFGenerator, RazorpayService
├── sentinel/            # Compliance enforcement layer
└── workers/
    ├── decayRescoreWorker.ts
    ├── influenceMapWorker.ts
    ├── outreach_worker.ts
    └── scrapeWorker.ts
client/
└── src/components/
    ├── AdminDashboard.tsx
    ├── CampaignFeed.tsx, ResultCard.tsx, ReEngageQueue.tsx ...
    └── views/
```

---

## 🔐 Security & Governance

| Layer | Implementation | Status |
|---|---|---|
| Multi-tenant vault isolation | PostgreSQL Row-Level Security | ✅ Active |
| PII anonymization | SovereignFirewall / AnonPipeline | ✅ Active |
| Audit trail | RAGAuditLog + AuditTrail.ts | ✅ Active |
| Compliance matrix | GDPR/DPDP/UAE PDPL | ✅ Active |
| HMAC data integrity | SHA-256 signed capsules & ROI PDFs | ✅ Active |
| Webhook HMAC verification | `x-source-signature` middleware | ⚠️ Pending |
| IP whitelisting on `/api/ingest` | CIDR block middleware | ⚠️ Pending |
| Tenant API key auth | `x-api-key` → `api_key_hash` lookup | ⚠️ Pending |

---

**ConvoSpan Intel | Government Registry Intelligence | Sovereign Alpha Edition**

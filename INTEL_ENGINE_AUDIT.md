# ConvoSpan Intel — Government Registry Intelligence Engine Audit

## 1. System Mission
ConvoSpan Intel is an institutional-grade B2B intelligence engine designed for high-verity lead generation in the India/UAE corridor. Its mission is to provide a proprietary data moat by triangulating **Government Registries** to detect discrete buying events:
- **Registry Ingestion**: High-reliability ingestion of MCA, GeM, RERA, and DGFT data.
- **Signal Correlation**: Identifying buying triggers from capital events, tenders, and import spikes.
- **Durable Entity Resolution**: Merging fragmented data into a single, high-verity organization profile.
- **Lead Intelligence**: Generating HMAC-signed, verity-checked data capsules for institutional stakeholders.

## 2. Repository Structure
The system is modularized for resilience:
- `src/lib`: Core infrastructure (managed `cache.ts`, durable `database.ts`, `model-api.ts` abstraction).
- `src/core`:
  - `entity-resolver.ts`: Durable Postgres organization registry with phonetic matching.
  - `gemini-chain.ts`: Multi-stage intelligence workers (Gate -> Qualifier -> Writer).
  - `signal-formatter.ts`: Structured fact extraction (Fact Cards).
- `src/workers`: BullMQ distributed worker clusters.
- `client/`: React-based "Sovereign Alpha" executive dashboard.

## 3. Registry Oracle (Ingestion)
The system leverages authoritative data sources instead of unstructured web content:
- **MCA21**: Capital increases, director changes, and new incorporations (India).
- **GeM Portal**: Government tenders, bid deadlines, and procurement categories.
- **RERA**: Structural project approvals indicating construction/infra demand.
- **DGFT**: Specialized import/export records for identifying large-scale equipment procurement.

## 4. Entity Resolution & Durable Storage
The system maintains a high-integrity Organization Index using a sophisticated resolution pipeline:
- **String Normalization**: Aggressive cleaning of legal suffixes and industry noise.
- **Phonetic Matching**: Uses the **Double Metaphone** algorithm in Postgres to resolve name variations.
- **Durable Persistence**: All entities are stored in PostgreSQL (`org_registry`) with a full audit log of all merges (`entity_merge_log`).
- **Distributed Locking**: Implements Postgres advisory locks to prevent ID collisions during concurrent registration.
- **Read-Through Caching**: **Upstash Redis** provides sub-ms access to frequently resolved entities.

## 5. ModelAPI Abstraction
AI interactions are decoupled from business logic via a provider-agnostic layer:
- **Config-Driven**: Roles (Gate, Qualifier, Writer) are configured for specific token limits and temperatures.
- **Operational Safety**: Built-in spend guards (daily per-key limits) and automated retries for JSON repair.
- **Provider Flexibility**: Can switch between Gemini, Claude, and local models via a single configuration change.

## 6. Signal Extraction & Scoring
Intelligence is derived through structured analysis:
- **Fact Cards**: Raw payloads are transformed into structured "Fact Cards" to preserve numerical verity.
- **Intent Decay**: Signals are scored via an exponential decay formula (30-day half-life).
- **Multi-Layer Deduplication**: Upstash-backed cache prevents replay signals using query IDs and content fingerprints.

## 7. Governance & Security
- **Sovereign Firewall**: PII is tokenized/masked before entering the intelligence layer.
- **HMAC Integrity**: All outgoing data capsules are signed via SHA-256 HMAC for origin verification.
- **RLS Partitioning**: Strict multi-tenant data isolation enforced at the database level.
- **Audit Trails**: JSON logging of all AI decisions, compliance events, and entity merges.

## 8. Scalability & Resilience
- **Managed Cache**: Upstash Redis eliminates self-hosted Redis operational overhead.
- **Durable Registry**: Postgres-based entity store ensures data is never lost to cache eviction.
- **Memory Guards**: Local health checks prevent worker oversubscription.
- **Stateless Intelligence**: The core intelligence logic is stateless, allowing for rapid horizontal scaling of ingestion nodes.

---

## §15. Data Provenance & Legal Standing
ConvoSpan Intel exclusively processes information from public registries, open data portals, and mandated corporate filings. By avoiding the scraping of private websites or proprietary databases:
- **Copyright & TOS Immunity**: The system does not violate the terms of service of private networks (e.g., LinkedIn, proprietary news aggregators).
- **GDPR / DPDP Compliance**: Extracted data relates strictly to B2B entities and authorized corporate representatives, minimizing personal data footprint.
- **Verifiable Auditability**: Every ingested fact is traceable back to a government or regulatory source URI, ensuring full legal defensibility and provenance for all generated intelligence.

---
**ConvoSpan Intel | Government Registry Intelligence Engine Audit | v2.5**

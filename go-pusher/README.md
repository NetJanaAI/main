# go-pusher — NetJana ConvoSpan Push Sidecar (Go)

A lightweight Go module that reads lead signals from the NetJana Postgres database and securely pushes minimal payloads to the ConvoSpan webhook receiver.

This is a **companion sidecar** to the main Node.js `CovospanPusher.ts`. Both use the identical signing format, so they interoperate with the same ConvoSpan receiver.

---

## Structure

```
go-pusher/
├── cmd/push/main.go     CLI entrypoint (single / batch / self-test)
├── pusher/
│   ├── pusher.go        Core library: sign, push, retry
│   └── pusher_test.go   Unit tests (httptest, no real network needed)
├── db/
│   └── db.go            Postgres helpers (fetch lead, log push result)
└── go.mod
```

---

## Build

```bash
cd go-pusher

# Download dependencies
go mod tidy

# Build the CLI binary
go build -o push ./cmd/push

# Run tests
go test ./pusher/...
```

---

## Usage

```bash
# Self-test: verify HMAC signing against known reference (no network needed)
./push --verify

# Push a single lead by UUID
./push 550e8400-e29b-41d4-a716-446655440000

# Batch push: all pending leads (not yet in covospan_push_log as SUCCESS)
./push --batch --limit 100
```

---

## Environment Variables

| Variable | Required | Purpose |
|---|---|---|
| `CONVOSPAN_WEBHOOK_URL` | ✅ | ConvoSpan receiver POST endpoint |
| `CONVOSPAN_API_KEY` | ✅ | `x-api-key` sent on every push |
| `NETJANA_HMAC_SECRET` | ✅ | Outbound HMAC signing secret |
| `DATABASE_URL` | ✅ | Postgres connection string (same as Node.js app) |
| `CONVOSPAN_CAMPAIGN_ID` | ➕ | Route signals to a specific campaign |
| `PUSHER_MAX_RETRIES` | ➕ | Retry limit (default: 3) |
| `PUSHER_TIMEOUT_SEC` | ➕ | HTTP timeout per attempt in seconds (default: 10) |

The Go binary reads these from the environment directly. For local dev, it also attempts to load `../../.env` (pointing at the project-root `.env`).

---

## Signing Format

Identical to `CovospanPusher.ts`:

```
signing_input = "${x-netjana-timestamp}.${x-netjana-nonce}.${rawBody}"
signature     = HMAC-SHA256(NETJANA_HMAC_SECRET, signing_input).hexLower()

Header: x-netjana-signature: <hex>
```

Retry behaviour: the **same** nonce+timestamp+signature is reused across all retry attempts of a single push call, ensuring ConvoSpan's nonce deduplication treats all retries as the same event.

---

## When to use the Go pusher vs Node.js pusher

| Scenario | Use |
|---|---|
| Lead emitted in real-time by the Gemini pipeline | Node.js `CovospanPusher.ts` (integrated with BullMQ workers) |
| Backfill / batch push of pending leads | Go CLI (`--batch` mode) — faster, lower memory |
| Cron-triggered push from a separate infra box | Go binary deployed as a standalone container |
| CI smoke test of signing correctness | Go (`--verify`) or `npx ts-node scripts/test-netjana-push.ts` |

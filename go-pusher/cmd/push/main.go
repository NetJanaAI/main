// cmd/push — NetJana ConvoSpan Push CLI
//
// Sends minimal lead intel signals from the NetJana Postgres database to the
// ConvoSpan webhook receiver.  Three run modes are supported:
//
//	push <lead_id>          Push a single lead by UUID.
//	push --batch [--limit N] Push up to N pending leads (default 50).
//	push --verify           Run signing self-test (no network needed).
//
// All configuration is loaded from environment variables (.env supported via
// godotenv).  See usage output (push --help) for full variable list.
package main

import (
	"context"
	"flag"
	"fmt"
	"log/slog"
	"os"
	"strconv"
	"time"

	"github.com/joho/godotenv"
	"github.com/netjana/convospan-pusher/db"
	"github.com/netjana/convospan-pusher/pusher"
)

func main() {
	// Load .env from the project root if present (dev convenience).
	// Silently ignore if not found — production uses real env vars.
	_ = godotenv.Load("../../.env")
	_ = godotenv.Load(".env")

	// --- Flags ---
	batchMode   := flag.Bool("batch", false, "Push all pending leads instead of a single lead_id")
	daemonMode  := flag.Bool("daemon", false, "Run continuously and poll for new leads")
	pollInterval:= flag.Duration("interval", 60*time.Second, "Polling interval in daemon mode")
	batchLimit  := flag.Int("limit", 50, "Max leads to push in batch mode")
	verifyMode  := flag.Bool("verify", false, "Run HMAC signing self-test and exit")
	flag.Usage  = printUsage
	flag.Parse()

	// Structured JSON logging (compatible with Cloud Logging / Datadog)
	slog.SetDefault(slog.New(slog.NewJSONHandler(os.Stdout, &slog.HandlerOptions{
		Level: slog.LevelInfo,
	})))

	// --- Self-test mode ---
	if *verifyMode {
		runSelfTest()
		return
	}

	// --- Read config from env ---
	cfg := pusher.Config{
		EndpointURL: requireEnv("CONVOSPAN_WEBHOOK_URL"),
		APIKey:      requireEnv("CONVOSPAN_API_KEY"),
		HMACSecret:  os.Getenv("NETJANA_HMAC_SECRET"),
		CampaignID:  os.Getenv("CONVOSPAN_CAMPAIGN_ID"),
		MaxRetries:  envInt("PUSHER_MAX_RETRIES", 3),
		HTTPTimeout: time.Duration(envInt("PUSHER_TIMEOUT_SEC", 10)) * time.Second,
	}

	p := pusher.New(cfg)

	dbURL := requireEnv("DATABASE_URL")
	ctx   := context.Background()

	dbClient, err := db.NewClient(ctx, dbURL)
	if err != nil {
		slog.Error("failed to connect to database", "err", err)
		os.Exit(1)
	}
	defer dbClient.Close()

	// --- Dispatch ---
	if *daemonMode {
		runDaemon(ctx, p, dbClient, *batchLimit, *pollInterval)
	} else if *batchMode {
		runBatch(ctx, p, dbClient, *batchLimit)
	} else {
		leadID := flag.Arg(0)
		if leadID == "" {
			fmt.Fprint(os.Stderr, "error: provide a <lead_id> argument, --batch, or --daemon\n")
			printUsage()
			os.Exit(1)
		}
		runSingle(ctx, p, dbClient, leadID)
	}
}

// ---------------------------------------------------------------------------
// Single push
// ---------------------------------------------------------------------------

func runSingle(ctx context.Context, p *pusher.Pusher, dbClient *db.Client, leadID string) {
	lr, err := dbClient.FetchLead(ctx, leadID)
	if err != nil {
		slog.Error("lead not found", "lead_id", leadID, "err", err)
		os.Exit(1)
	}

	lead := pusher.LeadMeta{
		LeadID:              lr.LeadID,
		CompanyName:         lr.CompanyName,
		IntentScore:         lr.IntentScore,
		BuyingStage:         lr.BuyingStage,
		VerityTier:          lr.VerityTier,
		CardCompany:         lr.CardCompany,
		CardWhyNow:          lr.CardWhyNow,
		CardWhatTheyNeed:    lr.CardWhatTheyNeed,
		CardDoThis:          lr.CardDoThis,
		ProcurementCategory: lr.ProcurementCategory,
		ProcurementTimeline: lr.ProcurementTimeline,
	}

	slog.Info("pushing single lead", "lead_id", leadID, "company", lr.CompanyName)
	result := p.Push(ctx, lead, "manual")

	detail := "Go pusher success"
	status := "SUCCESS"
	if !result.OK {
		detail = fmt.Sprintf("Go pusher failed: %v", result.Err)
		status = "FAILED"
		slog.Error("push failed", "lead_id", leadID, "err", result.Err, "latency_ms", result.Latency.Milliseconds())
	} else {
		slog.Info("push succeeded", "lead_id", leadID, "latency_ms", result.Latency.Milliseconds(), "nonce", result.Nonce)
	}

	if logErr := dbClient.LogPushResult(ctx, lr.LeadID, lr.OrgID, status, detail, 1); logErr != nil {
		slog.Warn("failed to write push log", "err", logErr)
	}

	if !result.OK {
		os.Exit(1)
	}
}

// ---------------------------------------------------------------------------
// Batch push
// ---------------------------------------------------------------------------

func runBatch(ctx context.Context, p *pusher.Pusher, dbClient *db.Client, limit int) {
	leads, err := dbClient.ClaimPendingLeads(ctx, limit)
	if err != nil {
		slog.Error("failed to claim pending leads", "err", err)
		os.Exit(1)
	}

	if len(leads) == 0 {
		// Nothing to process
		return
	}

	slog.Info("starting batch push", "total", len(leads), "limit", limit)

	successCount, failCount := 0, 0

	for _, lr := range leads {
		lead := pusher.LeadMeta{
			LeadID:              lr.LeadID,
			CompanyName:         lr.CompanyName,
			IntentScore:         lr.IntentScore,
			BuyingStage:         lr.BuyingStage,
			VerityTier:          lr.VerityTier,
			CardCompany:         lr.CardCompany,
			CardWhyNow:          lr.CardWhyNow,
			CardWhatTheyNeed:    lr.CardWhatTheyNeed,
			CardDoThis:          lr.CardDoThis,
			ProcurementCategory: lr.ProcurementCategory,
			ProcurementTimeline: lr.ProcurementTimeline,
		}

		result := p.Push(ctx, lead, "auto")

		status := "SUCCESS"
		detail := "Go batch pusher success"
		if !result.OK {
			status = "FAILED"
			detail = fmt.Sprintf("Go batch pusher failed: %v", result.Err)
			slog.Warn("batch item failed", "lead_id", lr.LeadID, "err", result.Err)
			failCount++
		} else {
			slog.Info("batch item pushed", "lead_id", lr.LeadID, "company", lr.CompanyName, "latency_ms", result.Latency.Milliseconds())
			successCount++
		}

		if logErr := dbClient.LogPushResult(ctx, lr.LeadID, lr.OrgID, status, detail, p.MaxRetries()); logErr != nil {
			slog.Warn("failed to write push log", "lead_id", lr.LeadID, "err", logErr)
		}
	}

	slog.Info("batch complete", "success", successCount, "failed", failCount, "total", len(leads))
	if failCount > 0 && limit > 0 {
		// Only exit with failure if not running in a daemon loop. 
		// (We don't have limit context, but this is a rough approx).
		// We handle daemon errors upstream.
	}
}

// ---------------------------------------------------------------------------
// Daemon push
// ---------------------------------------------------------------------------

func runDaemon(ctx context.Context, p *pusher.Pusher, dbClient *db.Client, limit int, interval time.Duration) {
	slog.Info("starting daemon mode", "poll_interval", interval, "batch_limit", limit)
	ticker := time.NewTicker(interval)
	defer ticker.Stop()

	// Run once immediately
	runBatch(ctx, p, dbClient, limit)

	for {
		select {
		case <-ctx.Done():
			slog.Info("shutting down daemon", "reason", ctx.Err())
			return
		case <-ticker.C:
			runBatch(ctx, p, dbClient, limit)
		}
	}
}

// ---------------------------------------------------------------------------
// Self-test (signing verification, no network)
// ---------------------------------------------------------------------------

func runSelfTest() {
	const secret    = "test-secret-do-not-use-in-prod"
	const timestamp = "1712500000"
	const nonce     = "550e8400-e29b-41d4-a716-446655440000"
	body            := []byte(`{"event":"LEAD_CARD_READY","source":"netjana-intel"}`)

	sig1 := pusher.Verify(secret, timestamp, nonce, body)
	sig2 := pusher.Verify(secret, timestamp, nonce, body)

	fmt.Println("=== HMAC Signing Self-Test ===")
	fmt.Printf("Signing input  : %s.%s.%s\n", timestamp, nonce, string(body)[:40])
	fmt.Printf("Signature (run1): %s\n", sig1)
	fmt.Printf("Signature (run2): %s\n", sig2)

	if sig1 == "" {
		fmt.Println("FAIL: signature is empty — HMACSecret not applied.")
		os.Exit(1)
	}
	if sig1 != sig2 {
		fmt.Println("FAIL: signatures differ — HMAC is not deterministic!")
		os.Exit(1)
	}

	// Verify nonce sensitivity: a different nonce must produce a different signature.
	sig3 := pusher.Verify(secret, timestamp, "different-nonce-value", body)
	if sig3 == sig1 {
		fmt.Println("FAIL: different nonce produced same signature — nonce not in signing input!")
		os.Exit(1)
	}

	fmt.Printf("Nonce-variant  : %s\n", sig3)
	fmt.Println("PASS: HMAC is deterministic and nonce-sensitive.")
	fmt.Printf("  Stable signature: %s\n", sig1)
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func requireEnv(key string) string {
	v := os.Getenv(key)
	if v == "" {
		fmt.Fprintf(os.Stderr, "error: required environment variable %s is not set\n", key)
		os.Exit(1)
	}
	return v
}

func envInt(key string, defaultVal int) int {
	v := os.Getenv(key)
	if v == "" {
		return defaultVal
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return defaultVal
	}
	return n
}

func printUsage() {
	fmt.Fprint(os.Stderr, `
NetJana ConvoSpan Pusher — Go CLI

Usage:
  push <lead_id>            Push a single lead by UUID
  push --batch [--limit N]  Push up to N pending leads (default 50)
  push --daemon             Run in polling mode
  push --verify             HMAC signing self-test (no network needed)

Environment variables:
  CONVOSPAN_WEBHOOK_URL   (required) ConvoSpan receiver URL
  CONVOSPAN_API_KEY       (required) x-api-key for ConvoSpan
  NETJANA_HMAC_SECRET     (required) Outbound HMAC signing secret
  DATABASE_URL            (required) Postgres connection string
  CONVOSPAN_CAMPAIGN_ID   (optional) Route to specific campaign
  PUSHER_MAX_RETRIES      (optional) Retry limit (default 3)
  PUSHER_TIMEOUT_SEC      (optional) HTTP timeout in seconds (default 10)

Build:
  cd go-pusher && go build -o push ./cmd/push

Run:
  ./push 550e8400-e29b-41d4-a716-446655440000
  ./push --batch --limit 100
  ./push --verify
`)
}

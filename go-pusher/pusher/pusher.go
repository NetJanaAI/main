// Package pusher implements a secure, minimal webhook client that pushes
// NetJana Intel lead signals to the ConvoSpan receiver.
//
// Signing format (identical to the TypeScript CovospanPusher):
//
//	signing_input = "${timestamp}.${nonce}.${rawBody}"
//	signature     = HMAC-SHA256(NETJANA_HMAC_SECRET, signing_input).hexLower()
//
// Headers sent on every request:
//
//	Content-Type          : application/json
//	x-source              : netjana-intel
//	x-api-key             : <CONVOSPAN_API_KEY>
//	x-netjana-timestamp   : <unix seconds>
//	x-netjana-nonce       : <uuid v4>
//	x-netjana-signature   : <hex>   (only when HMACSecret is configured)
package pusher

import (
	"bytes"
	"context"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"strconv"
	"time"

	"github.com/google/uuid"
)

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

// Config holds the runtime settings for a Pusher instance.
// All fields can be populated from environment variables — see NewFromEnv().
type Config struct {
	// EndpointURL is the ConvoSpan webhook receiver URL.
	// Env: CONVOSPAN_WEBHOOK_URL
	EndpointURL string

	// APIKey is sent as x-api-key on every outbound request.
	// Env: CONVOSPAN_API_KEY
	APIKey string

	// HMACSecret is the shared secret used to sign outbound payloads.
	// If empty, the x-netjana-signature header is omitted.
	// Env: NETJANA_HMAC_SECRET
	HMACSecret string

	// CampaignID optionally routes signals to a specific ConvoSpan campaign.
	// Env: CONVOSPAN_CAMPAIGN_ID
	CampaignID string

	// MaxRetries controls how many times a failed push is retried.
	// Default: 3
	MaxRetries int

	// RetryDelays is the list of wait durations between successive retries.
	// Must have len(RetryDelays) >= MaxRetries-1.
	// Default: [1s, 3s, 8s]
	RetryDelays []time.Duration

	// HTTPTimeout is applied to every individual HTTP request.
	// Default: 10s
	HTTPTimeout time.Duration
}

func (c *Config) setDefaults() {
	if c.MaxRetries == 0 {
		c.MaxRetries = 3
	}
	if len(c.RetryDelays) == 0 {
		c.RetryDelays = []time.Duration{1 * time.Second, 3 * time.Second, 8 * time.Second}
	}
	if c.HTTPTimeout == 0 {
		c.HTTPTimeout = 10 * time.Second
	}
}

// ---------------------------------------------------------------------------
// Payload types
// ---------------------------------------------------------------------------

// BuyingStage enumerates procurement lifecycle stages.
type BuyingStage string

const (
	BuyingStageAwareness     BuyingStage = "AWARENESS"
	BuyingStageConsideration BuyingStage = "CONSIDERATION"
	BuyingStageDecision      BuyingStage = "DECISION"
	BuyingStageUnknown       BuyingStage = "UNKNOWN"
)

// VerityTier classifies the signal quality tier.
type VerityTier string

const (
	VerityTier1 VerityTier = "TIER_1"
	VerityTier2 VerityTier = "TIER_2"
)

// EventType identifies the nature of the push event.
type EventType string

const (
	EventLeadCardReady  EventType = "LEAD_CARD_READY"
	EventSignalIngested EventType = "SIGNAL_INGESTED"
	EventIntentUpdated  EventType = "INTENT_UPDATED"
)

// LeadMeta is the minimal lead object included in every push.
// Verbose fields (card_why_now, card_what_they_need, card_do_this, etc.)
// are intentionally excluded — ConvoSpan pulls those on-demand via
// GET /v1/intel/leads/{lead_id}.
type LeadMeta struct {
	LeadID              string      `json:"lead_id"`
	CompanyName         string      `json:"company_name"`
	IntentScore         int         `json:"intent_score"` // 0..100
	BuyingStage         BuyingStage `json:"buying_stage,omitempty"`
	VerityTier          VerityTier  `json:"verity_tier,omitempty"`
	CardCompany         string      `json:"card_company,omitempty"`
	CardWhyNow          string      `json:"card_why_now,omitempty"`
	CardWhatTheyNeed    string      `json:"card_what_they_need,omitempty"`
	CardDoThis          string      `json:"card_do_this,omitempty"`
	ProcurementCategory string      `json:"procurement_category,omitempty"`
	ProcurementTimeline string      `json:"procurement_timeline,omitempty"`
}

// PushMeta carries housekeeping metadata attached to each push.
type PushMeta struct {
	PushedBy     string `json:"pushed_by"`      // "auto" | "manual"
	RetryAttempt int    `json:"retry_attempt,omitempty"`
}

// Payload is the minimal JSON body sent to ConvoSpan on each webhook push.
type Payload struct {
	Event      EventType `json:"event"`
	Source     string    `json:"source"`     // strictly "netjana-intel"
	Timestamp  string    `json:"timestamp"`  // ISO-8601
	Lead       LeadMeta  `json:"lead"`
	CampaignID string    `json:"campaign_id,omitempty"`
	Meta       PushMeta  `json:"meta"`
}

// ---------------------------------------------------------------------------
// Pusher
// ---------------------------------------------------------------------------

// Pusher is the main client for pushing lead signals to ConvoSpan.
// Create one with New() and reuse it — it maintains an http.Client internally.
type Pusher struct {
	cfg    Config
	client *http.Client
	log    *slog.Logger
}

// New creates a Pusher with the given Config.
// Call p.cfg.setDefaults() to fill zero values before constructing.
func New(cfg Config) *Pusher {
	cfg.setDefaults()
	return &Pusher{
		cfg:    cfg,
		client: &http.Client{Timeout: cfg.HTTPTimeout},
		log:    slog.Default().With("component", "CovospanPusher"),
	}
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

// PushResult summarises the outcome of a single push call.
type PushResult struct {
	OK         bool
	StatusCode int
	Latency    time.Duration
	Err        error
	// Nonce used for this push — useful for idempotency checks.
	Nonce string
}

// Push sends a minimal lead signal to ConvoSpan.
//
// The same nonce is reused across all retry attempts of a single Push() call,
// making receiver-side deduplication deterministic.
//
// ctx controls the total lifetime of the push including all retries.
func (p *Pusher) Push(ctx context.Context, lead LeadMeta, triggeredBy string) PushResult {
	if p.cfg.EndpointURL == "" || p.cfg.APIKey == "" {
		return PushResult{OK: false, Err: fmt.Errorf("pusher not configured: EndpointURL and APIKey are required")}
	}

	// Build payload
	payload := Payload{
		Event:      EventLeadCardReady,
		Source:     "netjana-intel",
		Timestamp:  time.Now().UTC().Format(time.RFC3339),
		Lead:       lead,
		CampaignID: p.cfg.CampaignID,
		Meta:       PushMeta{PushedBy: triggeredBy},
	}

	// Serialise ONCE — the exact bytes we sign must be the bytes we send.
	body, err := json.Marshal(payload)
	if err != nil {
		return PushResult{OK: false, Err: fmt.Errorf("failed to marshal payload: %w", err)}
	}

	// Nonce + timestamp are fixed for all retries of this push invocation.
	nonce := uuid.New().String()
	tsStr := strconv.FormatInt(time.Now().Unix(), 10)
	sig := computeSignature(p.cfg.HMACSecret, tsStr, nonce, body)

	var lastErr error
	start := time.Now()

	for attempt := 0; attempt < p.cfg.MaxRetries; attempt++ {
		if attempt > 0 {
			delay := p.retryDelay(attempt)
			p.log.Info("retrying push", "lead_id", lead.LeadID, "attempt", attempt+1, "delay", delay)
			select {
			case <-ctx.Done():
				return PushResult{OK: false, Nonce: nonce, Err: ctx.Err(), Latency: time.Since(start)}
			case <-time.After(delay):
			}
		}

		payload.Meta.RetryAttempt = attempt

		statusCode, err := p.doRequest(ctx, body, tsStr, nonce, sig)
		if err == nil && statusCode >= 200 && statusCode < 300 {
			p.log.Info("push succeeded", "lead_id", lead.LeadID, "attempt", attempt+1, "status", statusCode)
			return PushResult{OK: true, StatusCode: statusCode, Nonce: nonce, Latency: time.Since(start)}
		}

		if err != nil {
			lastErr = err
			p.log.Warn("push attempt failed (network)", "lead_id", lead.LeadID, "attempt", attempt+1, "err", err)
		} else {
			lastErr = fmt.Errorf("HTTP %d", statusCode)
			p.log.Warn("push attempt failed (HTTP)", "lead_id", lead.LeadID, "attempt", attempt+1, "status", statusCode)
		}
	}

	return PushResult{OK: false, Nonce: nonce, Err: lastErr, Latency: time.Since(start)}
}

// Verify computes the expected HMAC for a given set of inputs.
// Exported so test code and CLI tooling can reproduce signatures.
func Verify(secret, timestamp, nonce string, body []byte) string {
	return computeSignature(secret, timestamp, nonce, body)
}

// MaxRetries returns the configured retry limit for this Pusher instance.
// Used by callers (e.g. the CLI) that want to log how many attempts were made.
func (p *Pusher) MaxRetries() int {
	return p.cfg.MaxRetries
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

func (p *Pusher) doRequest(ctx context.Context, body []byte, tsStr, nonce, sig string) (int, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, p.cfg.EndpointURL, bytes.NewReader(body))
	if err != nil {
		return 0, fmt.Errorf("building request: %w", err)
	}

	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("x-source", "netjana-intel")
	req.Header.Set("x-api-key", p.cfg.APIKey)
	req.Header.Set("x-netjana-timestamp", tsStr)
	req.Header.Set("x-netjana-nonce", nonce)
	if sig != "" {
		req.Header.Set("x-netjana-signature", sig)
	}

	resp, err := p.client.Do(req)
	if err != nil {
		return 0, err
	}
	defer func() { _, _ = io.Copy(io.Discard, resp.Body); resp.Body.Close() }()

	return resp.StatusCode, nil
}

func (p *Pusher) retryDelay(attempt int) time.Duration {
	idx := attempt - 1
	if idx < len(p.cfg.RetryDelays) {
		return p.cfg.RetryDelays[idx]
	}
	return p.cfg.RetryDelays[len(p.cfg.RetryDelays)-1]
}

// computeSignature returns HMAC-SHA256(secret, "${timestamp}.${nonce}.${body}") as lowercase hex.
// Returns "" when secret is empty (signature header will be omitted).
func computeSignature(secret, timestamp, nonce string, body []byte) string {
	if secret == "" {
		return ""
	}
	mac := hmac.New(sha256.New, []byte(secret))
	mac.Write([]byte(timestamp))
	mac.Write([]byte("."))
	mac.Write([]byte(nonce))
	mac.Write([]byte("."))
	mac.Write(body)
	return hex.EncodeToString(mac.Sum(nil))
}

package pusher_test

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/netjana/convospan-pusher/pusher"
)

// ---------------------------------------------------------------------------
// Test 1 — HMAC signing is deterministic
// ---------------------------------------------------------------------------

func TestHMACStability(t *testing.T) {
	const secret    = "test-secret-do-not-use-in-prod"
	const timestamp = "1712500000"
	const nonce     = "550e8400-e29b-41d4-a716-446655440000"
	body            := []byte(`{"event":"LEAD_CARD_READY","source":"NetJana.AI / ConvoSpan Intel"}`)

	sig1 := pusher.Verify(secret, timestamp, nonce, body)
	sig2 := pusher.Verify(secret, timestamp, nonce, body)

	if sig1 != sig2 {
		t.Fatalf("HMAC is not deterministic: got %q and %q", sig1, sig2)
	}
	if sig1 == "" {
		t.Fatal("expected non-empty signature")
	}
	t.Logf("Stable signature: %s", sig1)
}

// ---------------------------------------------------------------------------
// Test 2 — Different nonce produces different signature (replay safety)
// ---------------------------------------------------------------------------

func TestHMACNonceChangesSignature(t *testing.T) {
	const secret    = "test-secret-do-not-use-in-prod"
	const timestamp = "1712500000"
	body            := []byte(`{"event":"LEAD_CARD_READY"}`)

	sig1 := pusher.Verify(secret, timestamp, "nonce-aaa", body)
	sig2 := pusher.Verify(secret, timestamp, "nonce-bbb", body)

	if sig1 == sig2 {
		t.Fatal("different nonces produced same signature — nonce is not included in signing input")
	}
}

// ---------------------------------------------------------------------------
// Test 3 — Pusher sends the correct minimal headers + body
// ---------------------------------------------------------------------------

func TestPushSendsCorrectHeaders(t *testing.T) {
	const secret = "supersecret"
	var capturedReq *http.Request
	var capturedBody []byte

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedReq = r.Clone(context.Background())
		capturedBody, _ = io.ReadAll(r.Body)
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := pusher.New(pusher.Config{
		EndpointURL: srv.URL,
		APIKey:      "test-api-key",
		HMACSecret:  secret,
		MaxRetries:  1,
	})

	lead := pusher.LeadMeta{
		LeadID:      "550e8400-e29b-41d4-a716-446655440000",
		CompanyName: "Acme Corp",
		IntentScore: 85,
		BuyingStage: pusher.BuyingStageConsideration,
		VerityTier:  pusher.VerityTier1,
	}

	result := p.Push(context.Background(), lead, "auto")
	if !result.OK {
		t.Fatalf("push failed: %v", result.Err)
	}

	// --- Header assertions ---
	assertHeader(t, capturedReq, "Content-Type", "application/json")
	assertHeader(t, capturedReq, "x-source", "netjana-intel")
	assertHeader(t, capturedReq, "x-api-key", "test-api-key")

	ts    := capturedReq.Header.Get("x-netjana-timestamp")
	nonce := capturedReq.Header.Get("x-netjana-nonce")
	sig   := capturedReq.Header.Get("x-netjana-signature")

	if ts == "" {
		t.Error("missing x-netjana-timestamp header")
	}
	if nonce == "" {
		t.Error("missing x-netjana-nonce header")
	}
	if sig == "" {
		t.Error("missing x-netjana-signature header")
	}

	// --- Verify signature matches expected ---
	expectedSig := pusher.Verify(secret, ts, nonce, capturedBody)
	if sig != expectedSig {
		t.Errorf("signature mismatch:\n  got:      %s\n  expected: %s", sig, expectedSig)
	}

	// --- Verify payload is minimal (no verbose card fields) ---
	var payload map[string]any
	if err := json.Unmarshal(capturedBody, &payload); err != nil {
		t.Fatalf("body is not valid JSON: %v", err)
	}
	leadObj, _ := payload["lead"].(map[string]any)
	for _, forbidden := range []string{"card_why_now", "card_what_they_need", "card_do_this", "is_triangulated", "decay_score", "geo_state"} {
		if _, found := leadObj[forbidden]; found {
			t.Errorf("verbose field %q must not appear in the push payload", forbidden)
		}
	}
	if _, ok := leadObj["lead_id"]; !ok {
		t.Error("lead_id must be present in push payload")
	}
	if _, ok := leadObj["intent_score"]; !ok {
		t.Error("intent_score must be present in push payload")
	}
}

// ---------------------------------------------------------------------------
// Test 4 — Push returns failure on non-2xx (no retry in test for speed)
// ---------------------------------------------------------------------------

func TestPushHandlesHTTPError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusUnauthorized)
	}))
	defer srv.Close()

	p := pusher.New(pusher.Config{
		EndpointURL: srv.URL,
		APIKey:      "wrong-key",
		MaxRetries:  1, // single attempt — no delay in test
	})

	result := p.Push(context.Background(), pusher.LeadMeta{
		LeadID:      "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
		CompanyName: "Test Co",
		IntentScore: 50,
	}, "manual")

	if result.OK {
		t.Fatal("expected push to fail for HTTP 401")
	}
	if result.StatusCode != 0 && result.StatusCode != http.StatusUnauthorized {
		t.Errorf("unexpected status code: %d", result.StatusCode)
	}
}

// ---------------------------------------------------------------------------
// Test 5 — Empty HMACSecret means no signature header sent
// ---------------------------------------------------------------------------

func TestPushOmitsSignatureWhenNoSecret(t *testing.T) {
	var capturedReq *http.Request

	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		capturedReq = r.Clone(context.Background())
		w.WriteHeader(http.StatusOK)
	}))
	defer srv.Close()

	p := pusher.New(pusher.Config{
		EndpointURL: srv.URL,
		APIKey:      "some-key",
		HMACSecret:  "", // intentionally empty
		MaxRetries:  1,
	})

	p.Push(context.Background(), pusher.LeadMeta{
		LeadID: "test-no-sig", CompanyName: "Test", IntentScore: 1,
	}, "auto")

	if capturedReq.Header.Get("x-netjana-signature") != "" {
		t.Error("x-netjana-signature should not be present when HMACSecret is empty")
	}
}

// ---------------------------------------------------------------------------
// Test 6 — Context cancellation stops retries
// ---------------------------------------------------------------------------

func TestPushRespectsContextCancellation(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		time.Sleep(2 * time.Second) // simulate slow responder
		w.WriteHeader(http.StatusGatewayTimeout)
	}))
	defer srv.Close()

	p := pusher.New(pusher.Config{
		EndpointURL: srv.URL,
		APIKey:      "key",
		MaxRetries:  3,
		HTTPTimeout: 5 * time.Second,
	})

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()

	start := time.Now()
	result := p.Push(ctx, pusher.LeadMeta{LeadID: "ctx-test", CompanyName: "X", IntentScore: 1}, "auto")
	elapsed := time.Since(start)

	if result.OK {
		t.Fatal("expected push to fail when context is cancelled")
	}
	// Should bail fast — well under 1 second, not waiting through all retries
	if elapsed > 1*time.Second {
		t.Errorf("context cancellation took too long: %v", elapsed)
	}
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

func assertHeader(t *testing.T, r *http.Request, key, expected string) {
	t.Helper()
	got := r.Header.Get(key)
	if got != expected {
		t.Errorf("header %q: got %q, want %q", key, got, expected)
	}
}

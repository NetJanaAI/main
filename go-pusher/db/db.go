// Package db provides a lightweight Postgres helper for querying NetJana
// lead cards and pushing them to ConvoSpan via the pusher package.
package db

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/netjana/convospan-pusher/pusher"
)

// LeadRow is the raw DB row returned for a single lead_card record.
type LeadRow struct {
	LeadID              string
	CompanyName         string
	IntentScore         int
	BuyingStage         pusher.BuyingStage
	VerityTier          pusher.VerityTier
	OrgID               string
	CreatedAt           time.Time
	CardCompany         string
	CardWhyNow          string
	CardWhatTheyNeed    string
	CardDoThis          string
	ProcurementCategory string
	ProcurementTimeline string
}

// Client wraps a pgxpool.Pool for lead card queries.
type Client struct {
	pool *pgxpool.Pool
}

// NewClient opens a connection pool against databaseURL.
func NewClient(ctx context.Context, databaseURL string) (*Client, error) {
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		return nil, err
	}
	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, err
	}
	return &Client{pool: pool}, nil
}

// Close releases the connection pool.
func (c *Client) Close() { c.pool.Close() }

// FetchLead retrieves a minimal lead record from lead_cards by lead_id.
// Only the fields needed for the push payload are selected — the full card
// stays in Postgres (accessible via the NetJana pull API).
func (c *Client) FetchLead(ctx context.Context, leadID string) (*LeadRow, error) {
	const q = `
		SELECT
			lead_id,
			company_name,
			COALESCE(intent_score, 0)                   AS intent_score,
			COALESCE(buying_stage, 'UNKNOWN')           AS buying_stage,
			COALESCE(verity_tier,  '')                  AS verity_tier,
			COALESCE(org_id,       '')                  AS org_id,
			created_at,
			COALESCE(card_company, '')                  AS card_company,
			COALESCE(card_why_now, '')                  AS card_why_now,
			COALESCE(card_what_they_need, '')           AS card_what_they_need,
			COALESCE(card_do_this, '')                  AS card_do_this,
			COALESCE(procurement_category, '')          AS procurement_category,
			COALESCE(procurement_timeline, '')          AS procurement_timeline
		FROM lead_cards
		WHERE lead_id = $1
		LIMIT 1
	`

	row := c.pool.QueryRow(ctx, q, leadID)
	var lr LeadRow
	err := row.Scan(
		&lr.LeadID,
		&lr.CompanyName,
		&lr.IntentScore,
		&lr.BuyingStage,
		&lr.VerityTier,
		&lr.OrgID,
		&lr.CreatedAt,
		&lr.CardCompany,
		&lr.CardWhyNow,
		&lr.CardWhatTheyNeed,
		&lr.CardDoThis,
		&lr.ProcurementCategory,
		&lr.ProcurementTimeline,
	)
	if err != nil {
		return nil, err
	}
	return &lr, nil
}

// ClaimPendingLeads returns up to limit lead_cards that are PENDING or have expired leases.
// It atomically locks and claims them using FOR UPDATE SKIP LOCKED.
func (c *Client) ClaimPendingLeads(ctx context.Context, limit int) ([]LeadRow, error) {
	const q = `
		UPDATE lead_cards
		SET push_status = 'PROCESSING',
		    locked_until = NOW() + INTERVAL '5 minute',
		    push_attempts = push_attempts + 1
		WHERE lead_id IN (
			SELECT lead_id
			FROM lead_cards lc
			WHERE push_status = 'PENDING'
			   OR (push_status = 'PROCESSING' AND locked_until < NOW())
			ORDER BY created_at ASC
			LIMIT $1
			FOR UPDATE SKIP LOCKED
		)
		RETURNING 
			lead_id,
			company_name,
			COALESCE(intent_score, 0)                   AS intent_score,
			COALESCE(buying_stage, 'UNKNOWN')           AS buying_stage,
			COALESCE(verity_tier,  '')                  AS verity_tier,
			COALESCE(org_id,       '')                  AS org_id,
			created_at,
			COALESCE(card_company, '')                  AS card_company,
			COALESCE(card_why_now, '')                  AS card_why_now,
			COALESCE(card_what_they_need, '')           AS card_what_they_need,
			COALESCE(card_do_this, '')                  AS card_do_this,
			COALESCE(procurement_category, '')          AS procurement_category,
			COALESCE(procurement_timeline, '')          AS procurement_timeline
	`

	rows, err := c.pool.Query(ctx, q, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var leads []LeadRow
	for rows.Next() {
		var lr LeadRow
		if err := rows.Scan(
			&lr.LeadID,
			&lr.CompanyName,
			&lr.IntentScore,
			&lr.BuyingStage,
			&lr.VerityTier,
			&lr.OrgID,
			&lr.CreatedAt,
			&lr.CardCompany,
			&lr.CardWhyNow,
			&lr.CardWhatTheyNeed,
			&lr.CardDoThis,
			&lr.ProcurementCategory,
			&lr.ProcurementTimeline,
		); err != nil {
			return nil, err
		}
		leads = append(leads, lr)
	}
	return leads, rows.Err()
}

// LogPushResult records the outcome of a push attempt in covospan_push_log
// and synchronizes the queue state in lead_cards.
func (c *Client) LogPushResult(ctx context.Context, leadID, orgID, status, detail string, attempts int) error {
	tx, err := c.pool.Begin(ctx)
	if err != nil {
		return err
	}
	defer tx.Rollback(ctx)

	const qLog = `
		INSERT INTO covospan_push_log (lead_id, org_id, status, detail, triggered_by, attempts)
		VALUES ($1, $2, $3, $4, 'auto', $5)
	`
	if _, err := tx.Exec(ctx, qLog, leadID, orgID, status, detail, attempts); err != nil {
		return err
	}

	queueState := status // SUCCESS or FAILED
	// If the attempt limit hasn't been breached, log as FAILED but allow the queue to naturally 
	// revert it to PENDING if attempts are still under limit.
	// Since push_attempts tracks total tries, we can just set push_status = status.
	// The Poison-Pill assumption (ARCH-012): We leave it as FAILED if it hard fails.
	const qUpdate = `
		UPDATE lead_cards
		SET push_status = $2
		WHERE lead_id = $1
	`
	if _, err := tx.Exec(ctx, qUpdate, leadID, queueState); err != nil {
		return err
	}

	return tx.Commit(ctx)
}

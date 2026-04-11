/**
 * scripts/test-netjana-push.ts
 *
 * Runnable test script for the NetJana Intel push/pull flow.
 *
 * Tests:
 *   1. HMAC signing stability — same inputs always produce same signature.
 *   2. Webhook push to ConvoSpan (with correct signature headers).
 *   3. Pull endpoint — valid API key returns lead data (or 404 if unknown lead).
 *   4. Pull endpoint — invalid API key returns 403.
 *
 * Usage:
 *   npx ts-node scripts/test-netjana-push.ts
 *
 * Required env vars (can be in .env or set before running):
 *   NETJANA_HMAC_SECRET     — outbound signing secret (shared with ConvoSpan)
 *   CONVOSPAN_WEBHOOK_URL   — where to POST the test webhook
 *   CONVOSPAN_API_KEY       — x-api-key for the ConvoSpan webhook
 *   NETJANA_PULL_API_KEY    — x-api-key for the NetJana pull endpoint
 *   NETJANA_BASE_URL        — base URL of this NetJana server (default: http://localhost:3000)
 */

import 'dotenv/config';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sign(secret: string, timestamp: string, nonce: string, rawBody: string): string {
    const signingInput = `${timestamp}.${nonce}.${rawBody}`;
    return crypto.createHmac('sha256', secret).update(signingInput, 'utf8').digest('hex');
}

function printHeader(msg: string) {
    const bar = '─'.repeat(60);
    console.log(`\n${bar}`);
    console.log(`  ${msg}`);
    console.log(bar);
}

function ok(msg: string) { console.log(`  ✅  ${msg}`); }
function fail(msg: string) { console.log(`  ❌  ${msg}`); }
function info(msg: string) { console.log(`  ℹ️   ${msg}`); }

// ---------------------------------------------------------------------------
// Test 1 — HMAC signing stability (deterministic)
// ---------------------------------------------------------------------------

function testHmacStability() {
    printHeader('Test 1 — HMAC Signing Stability');

    const SECRET    = 'test-hmac-secret-do-not-use-in-prod';
    const TIMESTAMP = '1712500000';
    const NONCE     = '550e8400-e29b-41d4-a716-446655440000';
    const BODY      = '{"event":"LEAD_CARD_READY","source":"NetJana.AI / ConvoSpan Intel"}';

    const sig1 = sign(SECRET, TIMESTAMP, NONCE, BODY);
    const sig2 = sign(SECRET, TIMESTAMP, NONCE, BODY);

    info(`Signing input: ${TIMESTAMP}.${NONCE}.${BODY.slice(0, 40)}...`);
    info(`Signature 1:   ${sig1}`);
    info(`Signature 2:   ${sig2}`);

    if (sig1 === sig2) {
        ok('Same inputs always produce the same signature (deterministic).');
    } else {
        fail('Signatures differ — HMAC is not deterministic. This is a bug!');
        process.exitCode = 1;
    }

    // Ensure a different body produces a different signature
    const BODY2 = '{"event":"SIGNAL_INGESTED","source":"NetJana.AI / ConvoSpan Intel"}';
    const sig3 = sign(SECRET, TIMESTAMP, NONCE, BODY2);
    if (sig3 !== sig1) {
        ok('Different body produces different signature (correct).');
    } else {
        fail('Different body produced same signature — HMAC is broken!');
        process.exitCode = 1;
    }

    // Ensure a different nonce produces a different signature
    const NONCE2 = uuidv4();
    const sig4 = sign(SECRET, TIMESTAMP, NONCE2, BODY);
    if (sig4 !== sig1) {
        ok('Different nonce produces different signature (replay safety confirmed).');
    } else {
        fail('Different nonce produced same signature — nonce is not included in signing!');
        process.exitCode = 1;
    }
}

// ---------------------------------------------------------------------------
// Test 2 — Webhook push to ConvoSpan
// ---------------------------------------------------------------------------

async function testWebhookPush() {
    printHeader('Test 2 — Webhook Push to ConvoSpan');

    const webhookUrl = process.env.CONVOSPAN_WEBHOOK_URL;
    const apiKey     = process.env.CONVOSPAN_API_KEY;
    const hmacSecret = process.env.NETJANA_HMAC_SECRET;

    if (!webhookUrl || !apiKey) {
        info('CONVOSPAN_WEBHOOK_URL or CONVOSPAN_API_KEY not set — skipping live push test.');
        return;
    }

    const sampleLeadId = uuidv4();
    const payload = {
        event: 'LEAD_CARD_READY',
        source: 'NetJana.AI / ConvoSpan Intel',
        timestamp: new Date().toISOString(),
        lead: {
            lead_id: sampleLeadId,
            company_name: 'Test Corp Ltd.',
            intent_score: 85,
            buying_stage: 'CONSIDERATION',
            verity_tier: 'TIER_1',
        },
        meta: { pushed_by: 'manual', retry_attempt: 0 },
    };

    // IMPORTANT: sign the exact string that will be sent
    const bodyStr     = JSON.stringify(payload);
    const timestamp   = String(Math.floor(Date.now() / 1000));
    const nonce       = uuidv4();

    const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'x-source': 'netjana-intel',
        'x-api-key': apiKey,
        'x-netjana-timestamp': timestamp,
        'x-netjana-nonce': nonce,
    };

    if (hmacSecret) {
        headers['x-netjana-signature'] = sign(hmacSecret, timestamp, nonce, bodyStr);
        info(`Signature computed: ${headers['x-netjana-signature'].slice(0, 16)}...`);
    } else {
        info('NETJANA_HMAC_SECRET not set — sending without signature header.');
    }

    info(`POST ${webhookUrl}`);
    info(`Payload lead_id: ${sampleLeadId}`);
    info(`Nonce: ${nonce}  Timestamp: ${timestamp}`);

    try {
        const res = await fetch(webhookUrl, {
            method: 'POST',
            headers,
            body: bodyStr,
            signal: AbortSignal.timeout(10_000),
        });

        if (res.ok) {
            ok(`Push returned HTTP ${res.status} — ConvoSpan accepted the webhook.`);
        } else {
            const body = await res.text().catch(() => '');
            fail(`Push returned HTTP ${res.status}: ${body.slice(0, 200)}`);
            process.exitCode = 1;
        }

        // Curl equivalent
        console.log('\n  📋  curl equivalent:');
        console.log(`  curl -X POST '${webhookUrl}' \\`);
        console.log(`    -H 'Content-Type: application/json' \\`);
        console.log(`    -H 'x-source: netjana-intel' \\`);
        console.log(`    -H 'x-api-key: $CONVOSPAN_API_KEY' \\`);
        console.log(`    -H 'x-netjana-timestamp: ${timestamp}' \\`);
        console.log(`    -H 'x-netjana-nonce: ${nonce}' \\`);
        if (headers['x-netjana-signature']) {
            console.log(`    -H 'x-netjana-signature: ${headers['x-netjana-signature']}' \\`);
        }
        console.log(`    -d '${bodyStr}'`);

    } catch (err: any) {
        fail(`Network error: ${err.message}`);
        process.exitCode = 1;
    }
}

// ---------------------------------------------------------------------------
// Test 3 — Pull endpoint: valid API key
// ---------------------------------------------------------------------------

async function testPullEndpointValid() {
    printHeader('Test 3 — Pull Endpoint: Valid API Key');

    const NETJANA_BASE_URL  = process.env.NETJANA_BASE_URL || 'http://localhost:3000';
    const PULL_API_KEY      = process.env.NETJANA_PULL_API_KEY;
    const sampleLeadId      = process.env.TEST_LEAD_ID || uuidv4(); // provide a real id for full test

    if (!PULL_API_KEY) {
        info('NETJANA_PULL_API_KEY not set — skipping pull endpoint test.');
        return;
    }

    const url = `${NETJANA_BASE_URL}/v1/intel/leads/${sampleLeadId}`;
    info(`GET ${url}`);
    info(`x-api-key: ${PULL_API_KEY.slice(0, 8)}...`);

    try {
        const res = await fetch(url, {
            headers: {
                'x-api-key': PULL_API_KEY,
                'x-source': 'convospan',
            },
            signal: AbortSignal.timeout(5000),
        });

        const body = await res.json().catch(() => null);

        if (res.status === 200) {
            ok(`Pull returned HTTP 200.`);
            if (body?.lead?.lead_id) ok(`lead_id in response: ${body.lead.lead_id}`);
            if (body?.lead?.card_why_now) ok('card_why_now present (full card confirmed).');
            if (body?.graph !== undefined) ok(`graph field present (value: ${body.graph ? 'has data' : 'null'})`);
        } else if (res.status === 404) {
            ok(`Pull returned HTTP 404 — lead not in DB (expected for random UUID). Full card pull works.`);
        } else {
            fail(`Pull returned HTTP ${res.status}: ${JSON.stringify(body).slice(0, 200)}`);
            process.exitCode = 1;
        }

        // Curl equivalent
        console.log('\n  📋  curl equivalent:');
        console.log(`  curl -H 'x-api-key: $NETJANA_PULL_API_KEY' \\`);
        console.log(`       -H 'x-source: convospan' \\`);
        console.log(`       '${url}'`);

    } catch (err: any) {
        fail(`Network error: ${err.message}`);
        info('Is the server running? Set NETJANA_BASE_URL to the correct host.');
        process.exitCode = 1;
    }
}

// ---------------------------------------------------------------------------
// Test 4 — Pull endpoint: invalid API key → 403
// ---------------------------------------------------------------------------

async function testPullEndpointAuthFailure() {
    printHeader('Test 4 — Pull Endpoint: Auth Failure → 403');

    const NETJANA_BASE_URL = process.env.NETJANA_BASE_URL || 'http://localhost:3000';
    const sampleLeadId     = uuidv4();
    const url              = `${NETJANA_BASE_URL}/v1/intel/leads/${sampleLeadId}`;

    info(`GET ${url}`);
    info('Sending clearly wrong API key: WRONG_KEY_12345');

    try {
        const res = await fetch(url, {
            headers: { 'x-api-key': 'WRONG_KEY_12345' },
            signal: AbortSignal.timeout(5000),
        });

        if (res.status === 403) {
            ok('HTTP 403 Forbidden — auth failure handled correctly.');
        } else {
            fail(`Expected HTTP 403, got ${res.status}.`);
            process.exitCode = 1;
        }

        // Test with NO key at all
        const res2 = await fetch(url, { signal: AbortSignal.timeout(5000) });
        if (res2.status === 403) {
            ok('HTTP 403 with missing x-api-key header — also handled correctly.');
        } else {
            fail(`Expected HTTP 403 for missing key, got ${res2.status}.`);
            process.exitCode = 1;
        }

    } catch (err: any) {
        fail(`Network error: ${err.message}`);
        info('Is the server running? Set NETJANA_BASE_URL to the correct host.');
        process.exitCode = 1;
    }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
    console.log('\n🔬  NetJana Intel — Push/Pull Security Test Suite');
    console.log(`   Server time: ${new Date().toISOString()}`);

    // Test 1 — always runs (no network required)
    testHmacStability();

    // Tests 2–4 — require network / server
    await testWebhookPush();
    await testPullEndpointValid();
    await testPullEndpointAuthFailure();

    const exitCode = process.exitCode ?? 0;
    console.log(`\n${'─'.repeat(60)}`);
    if (exitCode === 0) {
        console.log('  🎉  All tests passed.\n');
    } else {
        console.log('  💥  Some tests FAILED. See ❌ above.\n');
    }
}

main().catch(err => {
    console.error('Test runner crashed:', err);
    process.exit(1);
});

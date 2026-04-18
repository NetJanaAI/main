import { Worker, Job } from 'bullmq';
import { connection, DLQ_QUEUE_NAME } from '../lib/queue';
import axios from 'axios';
import { FailedAnalysis } from '../lib/DeadLetterQueue';

const SLACK_WEBHOOK_URL = process.env.SLACK_WEBHOOK_URL;
const PAGERDUTY_WEBHOOK_URL = process.env.PAGERDUTY_WEBHOOK_URL;

/**
 * DLQ Worker: Processes system-wide failures captured in the Dead Letter Queue.
 * Responsible for Slack/Sentry alerting and potentially orchestrating manual retries.
 */
export function setupDlqWorker() {
    console.log(`[DLQWorker] Starting worker for queue: ${DLQ_QUEUE_NAME}`);

    const worker = new Worker(DLQ_QUEUE_NAME, async (job: Job) => {
        const failure: FailedAnalysis = job.data;
        
        console.warn(`[DLQWorker] Processing failure for ${failure.url}: ${failure.error}`);

        // 1. Send Alert to Slack
        if (SLACK_WEBHOOK_URL) {
            try {
                await axios.post(SLACK_WEBHOOK_URL, {
                    text: `*🚨 Analysis Failure Detected*`,
                    attachments: [
                        {
                            color: "#FF0000",
                            fields: [
                                { title: "URL", value: failure.url, short: false },
                                { title: "Error", value: failure.error, short: false },
                                { title: "Timestamp", value: failure.timestamp || new Date().toISOString(), short: true }
                            ],
                            footer: "ConvoSpan Intel Sentinel | Dead Letter Queue"
                        }
                    ]
                });
            } catch (err: any) {
                console.error(`[DLQWorker] Failed to post to Slack:`, err.message);
            }
        } else {
            console.log(`[DLQWorker] SLACK_WEBHOOK_URL not configured. Skipping external alert.`);
        }

        // 2. Escalation Alert (PagerDuty)
        if (PAGERDUTY_WEBHOOK_URL) {
            try {
                await axios.post(PAGERDUTY_WEBHOOK_URL, {
                    payload: {
                        summary: `DLQ FAILURE: ${failure.error}`,
                        severity: "error",
                        source: "Intel Engine",
                        custom_details: {
                            url: failure.url,
                            source_queue: failure.sourceQueue,
                            timestamp: failure.timestamp
                        }
                    },
                    event_action: "trigger",
                    routing_key: PAGERDUTY_WEBHOOK_URL.split('/').pop() // Assuming generic integration
                });
            } catch (err: any) {
                console.error(`[DLQWorker] Failed to post to PagerDuty:`, err.message);
            }
        }

        // 3. Additional logic
        // No automatic retry per implementation plan rules
    }, { connection });

    worker.on('failed', (job, err) => {
        console.error(`[DLQWorker] Job ${job?.id} failed internally:`, err.message);
    });

    return worker;
}

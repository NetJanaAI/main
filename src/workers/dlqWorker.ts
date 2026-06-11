import { Worker, Job } from 'bullmq';
import { connection, DLQ_QUEUE_NAME, rawSignalsQueue, scrapeQueue, outreachQueue, tier2Queue } from '../lib/queue';
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

        // 3. Auto-retry logic based on DLQ_RETRY_LIMIT
        const limit = parseInt(process.env.DLQ_RETRY_LIMIT || '0', 10);
        if (limit > 0) {
            const retryCount = (failure.metadata?.retryCount || 0) as number;
            if (retryCount < limit) {
                console.log(`[DLQWorker] Auto-retrying failure for ${failure.url} (${retryCount + 1}/${limit})`);
                
                let payload;
                try {
                    payload = typeof failure.rawText === 'string' ? JSON.parse(failure.rawText) : failure.rawText;
                } catch {
                    payload = { data: failure.rawText };
                }

                const updatedMetadata = {
                    ...(failure.metadata || {}),
                    retryCount: retryCount + 1
                };

                const jobName = 'retry_job';
                const jobData = {
                    ...payload,
                    metadata: updatedMetadata
                };

                try {
                    switch (failure.sourceQueue) {
                        case 'raw_signals':
                            await rawSignalsQueue.add(jobName, jobData);
                            break;
                        case 'b2b-scrapes':
                            await scrapeQueue.add(jobName, jobData);
                            break;
                        case 'tier2_queue':
                            await tier2Queue.add(jobName, jobData);
                            break;
                        case 'outreach_queue':
                            await outreachQueue.add(jobName, jobData);
                            break;
                        default:
                            console.warn(`[DLQWorker] Unknown/unsupported source queue for auto-retry: ${failure.sourceQueue}`);
                    }
                } catch (err: any) {
                    console.error(`[DLQWorker] Failed to auto-retry job:`, err.message);
                }
            } else {
                console.warn(`[DLQWorker] Job for ${failure.url} exceeded auto-retry limit (${limit}). No more retries.`);
            }
        }
    }, { connection });

    worker.on('failed', (job, err) => {
        console.error(`[DLQWorker] Job ${job?.id} failed internally:`, err.message);
    });

    return worker;
}

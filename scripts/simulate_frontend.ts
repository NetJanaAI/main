
import { io } from 'socket.io-client';
import axios from 'axios';

const SERVER_URL = 'http://localhost:3000';

async function runSimulation() {
    console.log('--- Starting Frontend Simulation ---');

    // 1. Connect Socket
    const socket = io(SERVER_URL);

    socket.on('connect', () => {
        console.log('[Socket] Connected to server');
    });

    socket.on('log', (data) => {
        console.log(`[Log] ${data.timestamp} [${data.type}]: ${data.message}`);
    });

    socket.on('error', (data) => {
        console.error('[Socket] Error:', data);
        process.exit(1);
    });

    // 2. Listen for Completion
    const completionPromise = new Promise((resolve) => {
        socket.on('complete', (data) => {
            console.log('[Socket] Scrape Complete!');
            console.log('Result Data:', JSON.stringify(data.result, null, 2));
            resolve(data);
        });
    });

    // 3. Trigger Scrape via API
    try {
        console.log('[API] Triggering scrape...');
        const response = await axios.post(`${SERVER_URL}/api/scrape`, {
            url: 'https://example.com',
            useOnlineAI: true
        });
        console.log(`[API] Response: Job ID ${response.data.jobId}`);
    } catch (error: any) {
        console.error('[API] Request Failed:', error.message);
    }

    // 4. Wait for result
    await completionPromise;
    console.log('--- Simulation Success ---');
    socket.close();
    process.exit(0);
}

runSimulation();

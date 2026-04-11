import { Page } from 'playwright';

/**
 * humanizeScrolling: Simulates a human scrolling pattern with variable speeds and pauses.
 */
export async function humanizeScrolling(page: Page) {
    const scrollHeight = await page.evaluate(() => document.body.scrollHeight);
    const viewportHeight = await page.evaluate(() => window.innerHeight);
    
    let currentScroll = 0;
    while (currentScroll < scrollHeight) {
        // Random scroll distance (simulating a finger swipe or wheel turn)
        const distance = Math.floor(Math.random() * 300) + 100;
        currentScroll += distance;
        
        await page.evaluate((y) => window.scrollTo({ top: y, behavior: 'smooth' }), currentScroll);
        
        // Random pause between scrolls
        const pause = Math.floor(Math.random() * 800) + 200;
        await page.waitForTimeout(pause);
        
        // 10% chance of a "deep read" pause
        if (Math.random() > 0.9) {
            await page.waitForTimeout(Math.floor(Math.random() * 3000) + 1000);
        }
    }
}

/**
 * humanizeMouse: Simulates subtle mouse jitter and movement towards elements.
 */
export async function humanizeMouse(page: Page) {
    // Micro-jitter to simulate hand tremors / hover states
    for (let i = 0; i < 5; i++) {
        const x = Math.floor(Math.random() * 100) + 400;
        const y = Math.floor(Math.random() * 100) + 400;
        await page.mouse.move(x, y, { steps: 10 });
        await page.waitForTimeout(Math.floor(Math.random() * 200) + 50);
    }
}

/**
 * randomizedDwell: Simulates "reading time" on a page.
 */
export async function randomizedDwell(min = 2000, max = 5000) {
    const dwellTime = Math.floor(Math.random() * (max - min)) + min;
    console.log(`[Stealth] Dwelling for ${dwellTime}ms...`);
    await new Promise(r => setTimeout(r, dwellTime));
}

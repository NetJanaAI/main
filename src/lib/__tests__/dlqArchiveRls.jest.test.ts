// The DLQ archive is created lazily from LIKE dead_letter_queue, which does not copy RLS.
const queries: string[] = [];
jest.mock('../database', () => ({
    query: jest.fn(async (sql: string) => { queries.push(sql); return { rows: [], rowCount: 0 }; }),
}));
jest.mock('../queue', () => ({ dlqQueue: {}, tier2Queue: {} }));

import { DeadLetterQueue } from '../DeadLetterQueue';

it('turns on row level security for the archive it creates', async () => {
    await DeadLetterQueue.archiveOldEntries(30);
    expect(queries.some((q) => /ALTER TABLE dead_letter_queue_archive ENABLE ROW LEVEL SECURITY/.test(q))).toBe(true);
});

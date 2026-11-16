// Realtime events are tenant data: an event for org A must only ever reach sockets in room org:A.
import fs from 'fs';
import path from 'path';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { Server } from 'socket.io';
import { io as connect, Socket } from 'socket.io-client';
import { emitToOrg, relayWorkerEvent } from '../socketRooms';

const ORG_A = '11111111-1111-1111-1111-111111111111';
const ORG_B = '22222222-2222-2222-2222-222222222222';

let server: Server;
let port: number;
const clients: Socket[] = [];

// Mirrors the connection handler in server.ts: the server decides the room, the client cannot.
async function connectAs(orgId: string): Promise<{ socket: Socket; events: any[] }> {
    const socket = connect(`http://localhost:${port}`, { transports: ['websocket'], auth: { orgId } });
    clients.push(socket);
    const events: any[] = [];
    socket.onAny((event, data) => events.push({ event, data }));
    await new Promise<void>((resolve) => socket.on('connect', () => resolve()));
    await new Promise((r) => setTimeout(r, 50)); // let the server-side join complete
    return { socket, events };
}
const settle = () => new Promise((r) => setTimeout(r, 150));

beforeAll(async () => {
    const http = createServer();
    server = new Server(http, { transports: ['websocket'] });
    server.on('connection', (s) => {
        s.join(`org:${s.handshake.auth.orgId}`);
    });
    await new Promise<void>((resolve) => http.listen(0, resolve));
    port = (http.address() as AddressInfo).port;
});

afterAll(async () => {
    clients.forEach((c) => c.close());
    await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('emitToOrg', () => {
    it('delivers to the tenant room only', async () => {
        const a = await connectAs(ORG_A);
        const b = await connectAs(ORG_B);
        expect(emitToOrg(server, ORG_A, 'complete', { jobId: 'j1' })).toBe(true);
        await settle();
        expect(a.events).toEqual([{ event: 'complete', data: { jobId: 'j1' } }]);
        expect(b.events).toEqual([]);
    });

    it('drops events with no organization instead of broadcasting', async () => {
        const a = await connectAs(ORG_A);
        const b = await connectAs(ORG_B);
        for (const org of [undefined, null, '', 'default']) {
            expect(emitToOrg(server, org as any, 'log', { m: 'x' })).toBe(false);
        }
        await settle();
        expect(a.events).toEqual([]);
        expect(b.events).toEqual([]);
    });

    it('is a no-op without a socket server', () => {
        expect(emitToOrg(null, ORG_A, 'log', {})).toBe(false);
        expect(emitToOrg(undefined, ORG_A, 'log', {})).toBe(false);
    });
});

describe('relayWorkerEvent (Redis worker_events relay)', () => {
    it("routes a worker event to its tenant's room only", async () => {
        const a = await connectAs(ORG_A);
        const b = await connectAs(ORG_B);
        relayWorkerEvent(server, JSON.stringify({ event: 'log', data: { jobId: 'j2' }, organizationId: ORG_B }));
        await settle();
        expect(b.events).toEqual([{ event: 'log', data: { jobId: 'j2' } }]);
        expect(a.events).toEqual([]);
    });

    it('drops events without an organizationId and malformed messages', async () => {
        const a = await connectAs(ORG_A);
        const b = await connectAs(ORG_B);
        relayWorkerEvent(server, JSON.stringify({ event: 'complete', data: { jobId: 'j3' } }));
        relayWorkerEvent(server, JSON.stringify({ event: 'complete', data: {}, organizationId: 42 }));
        relayWorkerEvent(server, 'not json');
        relayWorkerEvent(server, JSON.stringify({ data: {}, organizationId: ORG_A }));
        await settle();
        expect(a.events).toEqual([]);
        expect(b.events).toEqual([]);
    });
});

describe('no global broadcasts', () => {
    function sourceFiles(dir: string): string[] {
        return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
            const p = path.join(dir, e.name);
            if (e.isDirectory()) return e.name === '__tests__' ? [] : sourceFiles(p);
            return p.endsWith('.ts') ? [p] : [];
        });
    }

    it('src has no io.emit / server-wide emit outside the helper', () => {
        const offenders: string[] = [];
        const root = path.join(__dirname, '..', '..');
        for (const file of sourceFiles(root)) {
            if (file.endsWith(path.join('lib', 'socketRooms.ts'))) continue;
            fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
                if (/\b(io|ioInstance|server|socketServer)\??\.emit\(/.test(line)) {
                    offenders.push(`${path.relative(root, file)}:${i + 1}: ${line.trim()}`);
                }
            });
        }
        expect(offenders).toEqual([]);
    });
});

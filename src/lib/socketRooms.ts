import type { Server } from 'socket.io';

export const orgRoom = (organizationId: string) => `org:${organizationId}`;

function isTenantId(value: unknown): value is string {
    return typeof value === 'string' && value !== '' && value !== 'default';
}

/**
 * Emits to one tenant's room. Events with no tenant (or no socket server) are dropped:
 * a missing tenant must never fall back to a broadcast.
 */
export function emitToOrg(
    io: Pick<Server, 'to'> | null | undefined,
    organizationId: string | null | undefined,
    event: string,
    data: unknown
): boolean {
    if (!io || !isTenantId(organizationId)) {
        if (io) console.warn(`[Socket] Dropped '${event}': no tenant to route it to`);
        return false;
    }
    io.to(orgRoom(organizationId)).emit(event, data);
    return true;
}

/** Handles one message from the Redis `worker_events` channel: `{ event, data, organizationId }`. */
export function relayWorkerEvent(io: Pick<Server, 'to'>, message: string): boolean {
    let parsed: any;
    try {
        parsed = JSON.parse(message);
    } catch {
        console.warn('[Socket] Dropped malformed worker event');
        return false;
    }
    if (typeof parsed?.event !== 'string') return false;
    return emitToOrg(io, parsed.organizationId, parsed.event, parsed.data);
}

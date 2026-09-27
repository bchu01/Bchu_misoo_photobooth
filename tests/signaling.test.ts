/**
 * Integration coverage for the socket protocol itself: a real server, real
 * clients, real acks. The unit tests in `rooms.test.ts` cover the rules; these
 * cover the wiring, validation, and authorization at the boundary.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { io as connect, type Socket } from 'socket.io-client';
import { SHOTS_PER_SESSION } from '@bchu/shared';
import type {
  Ack,
  CaptureCountdownEvent,
  PeerSignalEvent,
  RoomMembership,
  RoomState,
} from '@bchu/shared';
import { loadConfig } from '../apps/signaling/src/config';
import { RateLimiter } from '../apps/signaling/src/middleware/rateLimit';
import { createSignalingService } from '../apps/signaling/src/server';

let service: ReturnType<typeof createSignalingService>;
let url: string;
const openSockets: Socket[] = [];

beforeAll(async () => {
  service = createSignalingService({
    config: loadConfig({ WEB_ORIGIN: 'http://localhost:3000' }),
    // Every client here shares one loopback address; the real limits are
    // exercised as a unit in `rooms.test.ts`.
    rateLimiter: new RateLimiter({
      limits: {
        'room:create': { tokens: 1000, refillPerMinute: 1000 },
        'room:join': { tokens: 1000, refillPerMinute: 1000 },
        'room:resume': { tokens: 1000, refillPerMinute: 1000 },
      },
    }),
  });
  // Port 0 asks the OS for a free port, so tests never collide with a dev server.
  const port = await service.listen(0);
  url = `http://localhost:${port}`;
});

afterAll(async () => {
  for (const socket of openSockets) socket.disconnect();
  await service?.close();
});

async function client(): Promise<Socket> {
  const socket = connect(url, { transports: ['websocket'], forceNew: true });
  openSockets.push(socket);
  await new Promise<void>((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function send<T>(socket: Socket, event: string, payload: unknown): Promise<Ack<T>> {
  return new Promise((resolve, reject) => {
    socket.timeout(4000).emit(event, payload, (transportError: Error | null, ack: Ack<T>) => {
      if (transportError) reject(transportError);
      else resolve(ack);
    });
  });
}

function nextEvent<T>(socket: Socket, event: string, timeoutMs = 4000): Promise<T> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, onEvent);
      reject(new Error(`Timed out waiting for "${event}"`));
    }, timeoutMs);

    function onEvent(payload: T): void {
      clearTimeout(timer);
      socket.off(event, onEvent);
      resolve(payload);
    }
    socket.on(event, onEvent);
  });
}

/**
 * Waits for a room snapshot that satisfies `predicate`. Room state is broadcast
 * on every change, so matching on content rather than on the next event keeps
 * these tests from latching onto an unrelated update.
 */
function waitForState(
  socket: Socket,
  predicate: (state: RoomState) => boolean,
  timeoutMs = 4000,
): Promise<RoomState> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('room:state', onState);
      reject(new Error('Timed out waiting for a matching room:state'));
    }, timeoutMs);

    function onState(state: RoomState): void {
      if (!predicate(state)) return;
      clearTimeout(timer);
      socket.off('room:state', onState);
      resolve(state);
    }
    socket.on('room:state', onState);
  });
}

function unwrap<T>(ack: Ack<T>): T {
  if (!ack.ok) throw new Error(`Expected success, got ${ack.error.code}`);
  return ack.data;
}

function errorCode(ack: Ack<unknown>): string | null {
  return ack.ok ? null : ack.error.code;
}

async function markReady(socket: Socket): Promise<void> {
  await send(socket, 'peer:ready', { cameraReady: true, dataChannelReady: true });
}

/** A host and guest already seated in a fresh room. */
async function seatedRoom() {
  const host = await client();
  const membership = unwrap<RoomMembership>(await send(host, 'room:create', {}));

  const guest = await client();
  const guestMembership = unwrap<RoomMembership>(
    await send(guest, 'room:join', { code: membership.code }),
  );

  return { host, guest, membership, guestMembership, code: membership.code };
}

describe('room membership over the wire', () => {
  it('creates a room and returns a six-character code with a token', async () => {
    const host = await client();
    const membership = unwrap<RoomMembership>(await send(host, 'room:create', {}));

    expect(membership.code).toMatch(/^[A-Z0-9]{6}$/);
    expect(membership.role).toBe('host');
    expect(membership.reconnectToken.length).toBeGreaterThan(16);
    expect(membership.state.status).toBe('waiting');
  });

  it('lets a guest join and tells the host', async () => {
    const host = await client();
    const membership = unwrap<RoomMembership>(await send(host, 'room:create', {}));
    const seated = waitForState(host, (state) => state.guest !== null);

    const guest = await client();
    const guestMembership = unwrap<RoomMembership>(
      await send(guest, 'room:join', { code: membership.code }),
    );

    expect(guestMembership.role).toBe('guest');
    expect((await seated).guest?.role).toBe('guest');
  });

  it('rejects a third participant', async () => {
    const { code } = await seatedRoom();
    const third = await client();

    expect(errorCode(await send(third, 'room:join', { code }))).toBe('FULL');
  });

  it('rejects an unknown code', async () => {
    const guest = await client();
    expect(errorCode(await send(guest, 'room:join', { code: 'ZZZZZZ' }))).toBe('NOT_FOUND');
  });

  it('rejects a malformed code without creating anything', async () => {
    const guest = await client();
    const before = service.registry.size;

    expect(errorCode(await send(guest, 'room:join', { code: 'no' }))).toBe('INVALID_PAYLOAD');
    // Ambiguous characters are excluded from the alphabet on purpose.
    expect(errorCode(await send(guest, 'room:join', { code: 'OOIIL1' }))).toBe('INVALID_PAYLOAD');
    expect(service.registry.size).toBe(before);
  });

  it('normalizes lowercase and padded codes', async () => {
    const { code } = await seatedRoom();
    const rejoin = await client();

    // Still FULL rather than NOT_FOUND, which proves the code was normalized.
    expect(errorCode(await send(rejoin, 'room:join', { code: ` ${code.toLowerCase()} ` }))).toBe('FULL');
  });

  it('resumes with a valid token and rotates it', async () => {
    const { membership, code } = await seatedRoom();
    const rebound = await client();

    const resumed = unwrap<RoomMembership>(
      await send(rebound, 'room:resume', { code, reconnectToken: membership.reconnectToken }),
    );

    expect(resumed.role).toBe('host');
    expect(resumed.reconnectToken).not.toBe(membership.reconnectToken);
  });

  it('refuses to resume with a wrong token', async () => {
    const { code } = await seatedRoom();
    const stranger = await client();

    const ack = await send(stranger, 'room:resume', {
      code,
      reconnectToken: 'x'.repeat(43),
    });
    expect(errorCode(ack)).toBe('INVALID_TOKEN');
  });
});

describe('signal forwarding', () => {
  it('forwards an offer to the other participant only', async () => {
    const { host, guest } = await seatedRoom();
    const received = nextEvent<PeerSignalEvent>(guest, 'peer:signal');

    unwrap(await send(host, 'peer:signal', { type: 'offer', data: '{"sdp":"fake"}' }));

    expect((await received).type).toBe('offer');
  });

  it('refuses to forward for a socket in no room', async () => {
    const stranger = await client();
    const ack = await send(stranger, 'peer:signal', { type: 'ice', data: '{}' });

    expect(errorCode(ack)).toBe('NOT_IN_ROOM');
  });

  it('rejects an oversized signal so the service cannot relay bulk data', async () => {
    const { host } = await seatedRoom();
    const ack = await send(host, 'peer:signal', { type: 'offer', data: 'x'.repeat(20_000) });

    expect(errorCode(ack)).toBe('INVALID_PAYLOAD');
  });
});

describe('capture control', () => {
  it('refuses to start before both sides are ready', async () => {
    const { host } = await seatedRoom();
    expect(errorCode(await send(host, 'capture:start', { eventId: 'evt-00001' }))).toBe('NOT_READY');
  });

  it('refuses a capture command from the guest', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);

    expect(errorCode(await send(guest, 'capture:start', { eventId: 'evt-00002' }))).toBe('NOT_HOST');
    expect(errorCode(await send(guest, 'capture:retake', { eventId: 'evt-00003' }))).toBe('NOT_HOST');
  });

  it('schedules a countdown in the future for both participants', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);

    const hostCountdown = nextEvent<CaptureCountdownEvent>(host, 'capture:countdown');
    const guestCountdown = nextEvent<CaptureCountdownEvent>(guest, 'capture:countdown');
    unwrap(await send(host, 'capture:start', { eventId: 'evt-00004' }));

    const [onHost, onGuest] = await Promise.all([hostCountdown, guestCountdown]);

    // Both sides are told the same shot and the same start time.
    expect(onHost.shotNumber).toBe(1);
    expect(onGuest.shotNumber).toBe(1);
    expect(onHost.startAt).toBe(onGuest.startAt);
    expect(onHost.startAt).toBeGreaterThan(Date.now());
    expect(onHost.sessionId).toBe(onGuest.sessionId);
  });

  it('advances only once both participants confirm receipt', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);

    const firstCountdown = nextEvent<CaptureCountdownEvent>(host, 'capture:countdown');
    unwrap(await send(host, 'capture:start', { eventId: 'evt-00005' }));
    const { sessionId } = await firstCountdown;

    const base = { sessionId, shotNumber: 1, stage: 'peer-received' as const };
    unwrap(await send(host, 'capture:ack', { ...base, eventId: 'ack-host-1' }));

    // One confirmation is not enough to complete the shot.
    let state = await send<RoomState>(host, 'peer:ready', {
      cameraReady: true,
      dataChannelReady: true,
    });
    expect(unwrap(state).completedShots).toEqual([]);

    const advanced = nextEvent<CaptureCountdownEvent>(guest, 'capture:countdown');
    unwrap(await send(guest, 'capture:ack', { ...base, eventId: 'ack-guest-1' }));

    expect((await advanced).shotNumber).toBe(2);

    state = await send<RoomState>(host, 'peer:ready', { cameraReady: true, dataChannelReady: true });
    expect(unwrap(state).completedShots).toEqual([1]);
  });

  it('completes the session after every shot and stops scheduling', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);

    const firstCountdown = nextEvent<CaptureCountdownEvent>(host, 'capture:countdown');
    unwrap(await send(host, 'capture:start', { eventId: 'evt-00006' }));
    const { sessionId } = await firstCountdown;

    for (let shot = 1; shot <= SHOTS_PER_SESSION; shot += 1) {
      const base = { sessionId, shotNumber: shot, stage: 'peer-received' as const };
      unwrap(await send(host, 'capture:ack', { ...base, eventId: `done-h-${shot}` }));
      unwrap(await send(guest, 'capture:ack', { ...base, eventId: `done-g-${shot}` }));
    }

    const state = unwrap(
      await send<RoomState>(host, 'peer:ready', { cameraReady: true, dataChannelReady: true }),
    );
    expect(state.completedShots).toEqual([1, 2, 3, 4]);
    expect(state.status).toBe('complete');
  });

  it('rejects an acknowledgement for a session that is not current', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);
    unwrap(await send(host, 'capture:start', { eventId: 'evt-00007' }));

    const ack = await send(host, 'capture:ack', {
      sessionId: '00000000-0000-4000-8000-000000000000',
      shotNumber: 1,
      eventId: 'stale-ack',
      stage: 'local',
    });
    expect(errorCode(ack)).toBe('SESSION_MISMATCH');
  });

  it('tells both participants when the host retakes', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);
    unwrap(await send(host, 'capture:start', { eventId: 'evt-00008' }));

    const aborted = nextEvent<{ reason: string }>(guest, 'capture:abort');
    unwrap(await send(host, 'capture:retake', { eventId: 'evt-00009' }));

    expect((await aborted).reason).toBe('host-retake');
  });

  it('reports a departed peer to the one who stayed', async () => {
    const { host, guest } = await seatedRoom();
    await markReady(host);
    await markReady(guest);

    const stateChange = waitForState(host, (state) => state.guest === null);
    unwrap(await send(guest, 'room:leave', {}));

    expect((await stateChange).status).toBe('waiting');
  });

  it('serves a server timestamp for clock offset estimation', async () => {
    const host = await client();
    const before = Date.now();
    const { serverTime } = unwrap<{ serverTime: number }>(
      await send(host, 'time:sync', { clientTime: before }),
    );

    expect(serverTime).toBeGreaterThanOrEqual(before);
  });
});

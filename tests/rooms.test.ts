import { beforeEach, describe, expect, it } from 'vitest';
import {
  CAPTURE_SCHEDULE_LEAD_MS,
  RECONNECT_GRACE_MS,
  ROOM_TTL_MS,
  SHOTS_PER_SESSION,
  SHOT_TRANSFER_TIMEOUT_MS,
} from '@bchu/shared';
import { RateLimiter } from '../apps/signaling/src/middleware/rateLimit';
import { RoomRegistry } from '../apps/signaling/src/rooms/registry';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  markDisconnected,
  requireMembership,
  resumeRoom,
  setReady,
  sweep,
  toRoomState,
} from '../apps/signaling/src/rooms/lifecycle';
import {
  recordCaptureAck,
  retakeCapture,
  startCapture,
} from '../apps/signaling/src/rooms/captureSession';

/** Deterministic clock and code generator so the rules can be asserted exactly. */
function makeRegistry() {
  let now = 1_000_000;
  let codeCounter = 0;
  let sessionCounter = 0;

  const registry = new RoomRegistry({
    now: () => now,
    generateCode: () => `ROOM${String(codeCounter++).padStart(2, '0')}`,
    newSessionId: () => `00000000-0000-4000-8000-${String(++sessionCounter).padStart(12, '0')}`,
  });

  return {
    registry,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

function bothReady(registry: RoomRegistry, hostSocket: string, guestSocket: string) {
  setReady(registry, hostSocket, { cameraReady: true, dataChannelReady: true });
  setReady(registry, guestSocket, { cameraReady: true, dataChannelReady: true });
}

function fullRoom() {
  const { registry, advance } = makeRegistry();
  const host = createRoom(registry, 'socket-host');
  const joined = joinRoom(registry, 'socket-guest', host.room.code);
  if (!joined.ok) throw new Error('fixture failed to seat a guest');
  bothReady(registry, 'socket-host', 'socket-guest');
  return { registry, advance, host, guest: joined.value };
}

describe('room creation and joining', () => {
  let context: ReturnType<typeof makeRegistry>;

  beforeEach(() => {
    context = makeRegistry();
  });

  it('seats the creator as host and waits for a friend', () => {
    const { room, role, reconnectToken } = createRoom(context.registry, 'socket-host');

    expect(role).toBe('host');
    expect(room.status).toBe('waiting');
    expect(room.guest).toBeNull();
    expect(reconnectToken.length).toBeGreaterThan(16);
  });

  it('never stores the raw reconnect token', () => {
    const { room, reconnectToken } = createRoom(context.registry, 'socket-host');

    expect(room.host.reconnectTokenHash).not.toBe(reconnectToken);
    expect(JSON.stringify(toRoomState(room))).not.toContain(reconnectToken);
  });

  it('keeps tokens and socket ids out of the client-facing state', () => {
    const { room } = createRoom(context.registry, 'socket-host');
    const serialized = JSON.stringify(toRoomState(room));

    expect(serialized).not.toContain('socket-host');
    expect(serialized).not.toContain(room.host.reconnectTokenHash);
  });

  it('admits exactly one guest and rejects a third participant', () => {
    const { room } = createRoom(context.registry, 'socket-host');

    expect(joinRoom(context.registry, 'socket-guest', room.code).ok).toBe(true);

    const third = joinRoom(context.registry, 'socket-third', room.code);
    expect(third.ok).toBe(false);
    expect(third.ok ? null : third.code).toBe('FULL');
  });

  it('reports an unknown code rather than creating a room', () => {
    const before = context.registry.size;
    const result = joinRoom(context.registry, 'socket-guest', 'ZZZZZZ');

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.code).toBe('NOT_FOUND');
    expect(context.registry.size).toBe(before);
  });

  it('rejects joining an expired room', () => {
    const { room } = createRoom(context.registry, 'socket-host');
    context.advance(ROOM_TTL_MS + 1);

    const result = joinRoom(context.registry, 'socket-guest', room.code);
    expect(result.ok ? null : result.code).toBe('EXPIRED');
  });

  it('never reissues a code that is still in use', () => {
    const codes = new Set<string>();
    for (let index = 0; index < 5; index += 1) {
      codes.add(createRoom(context.registry, `socket-${index}`).room.code);
    }
    expect(codes.size).toBe(5);
  });
});

describe('rate limiting room entry', () => {
  /**
   * Six-character codes are short enough that unlimited join attempts would make
   * guessing a live room practical, so the allowance must actually run out.
   */
  it('stops a caller once its allowance is spent', () => {
    const limiter = new RateLimiter({
      now: () => 0,
      limits: {
        'room:create': { tokens: 2, refillPerMinute: 2 },
        'room:join': { tokens: 3, refillPerMinute: 3 },
        'room:resume': { tokens: 3, refillPerMinute: 3 },
      },
    });

    expect(limiter.consume('1.2.3.4', 'room:join')).toBe(true);
    expect(limiter.consume('1.2.3.4', 'room:join')).toBe(true);
    expect(limiter.consume('1.2.3.4', 'room:join')).toBe(true);
    expect(limiter.consume('1.2.3.4', 'room:join')).toBe(false);
  });

  it('tracks callers and events separately', () => {
    const limiter = new RateLimiter({
      now: () => 0,
      limits: {
        'room:create': { tokens: 1, refillPerMinute: 1 },
        'room:join': { tokens: 1, refillPerMinute: 1 },
        'room:resume': { tokens: 1, refillPerMinute: 1 },
      },
    });

    expect(limiter.consume('1.2.3.4', 'room:join')).toBe(true);
    expect(limiter.consume('1.2.3.4', 'room:join')).toBe(false);
    // A different address and a different event each keep their own allowance.
    expect(limiter.consume('5.6.7.8', 'room:join')).toBe(true);
    expect(limiter.consume('1.2.3.4', 'room:create')).toBe(true);
  });

  it('refills over time', () => {
    let now = 0;
    const limiter = new RateLimiter({
      now: () => now,
      limits: {
        'room:create': { tokens: 1, refillPerMinute: 1 },
        'room:join': { tokens: 1, refillPerMinute: 1 },
        'room:resume': { tokens: 1, refillPerMinute: 1 },
      },
    });

    expect(limiter.consume('1.2.3.4', 'room:create')).toBe(true);
    expect(limiter.consume('1.2.3.4', 'room:create')).toBe(false);

    now += 60_000;
    expect(limiter.consume('1.2.3.4', 'room:create')).toBe(true);
  });
});

describe('membership authorization', () => {
  it('resolves a socket to its own role only', () => {
    const { registry, host, guest } = fullRoom();

    const asHost = requireMembership(registry, 'socket-host');
    const asGuest = requireMembership(registry, 'socket-guest');

    expect(asHost.ok && asHost.value.role).toBe('host');
    expect(asGuest.ok && asGuest.value.role).toBe('guest');
    expect(host.room.code).toBe(guest.room.code);
  });

  it('refuses a socket that is in no room', () => {
    const { registry } = fullRoom();
    const result = requireMembership(registry, 'socket-stranger');

    expect(result.ok).toBe(false);
    expect(result.ok ? null : result.code).toBe('NOT_IN_ROOM');
  });
});

describe('reconnect tokens', () => {
  it('rebinds the same role and rotates the token', () => {
    const { registry, host } = fullRoom();
    markDisconnected(registry, 'socket-host');

    const resumed = resumeRoom(registry, 'socket-host-2', host.room.code, host.reconnectToken);

    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.value.role).toBe('host');
    expect(resumed.value.reconnectToken).not.toBe(host.reconnectToken);
  });

  it('refuses a rotated-away token so a leaked copy cannot be replayed', () => {
    const { registry, host } = fullRoom();
    const first = resumeRoom(registry, 'socket-host-2', host.room.code, host.reconnectToken);
    expect(first.ok).toBe(true);

    const replay = resumeRoom(registry, 'socket-host-3', host.room.code, host.reconnectToken);
    expect(replay.ok ? null : replay.code).toBe('INVALID_TOKEN');
  });

  it('refuses a wrong token even with a valid code', () => {
    const { registry, host } = fullRoom();
    const result = resumeRoom(registry, 'socket-x', host.room.code, 'not-the-real-token-value');

    expect(result.ok ? null : result.code).toBe('INVALID_TOKEN');
  });

  it('requires readiness to be re-established after a rebind', () => {
    const { registry, guest } = fullRoom();
    markDisconnected(registry, 'socket-guest');

    const resumed = resumeRoom(registry, 'socket-guest-2', guest.room.code, guest.reconnectToken);
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;

    expect(resumed.value.room.guest?.cameraReady).toBe(false);
    expect(resumed.value.room.guest?.dataChannelReady).toBe(false);
    expect(resumed.value.room.status).toBe('connecting');
  });

  it('invalidates the leaver\u2019s token immediately', () => {
    const { registry, guest } = fullRoom();
    leaveRoom(registry, 'socket-guest');

    const result = resumeRoom(registry, 'socket-guest-2', guest.room.code, guest.reconnectToken);
    expect(result.ok ? null : result.code).toBe('INVALID_TOKEN');
  });
});

describe('expiry and sweeping', () => {
  it('expires a room past its absolute lifetime', () => {
    const { registry, advance, host } = fullRoom();
    advance(ROOM_TTL_MS + 1);

    const result = sweep(registry);

    expect(result.expiredRooms.map((room) => room.code)).toContain(host.room.code);
    expect(registry.get(host.room.code)).toBeUndefined();
  });

  it('holds a disconnected role for the grace period, then expires the room', () => {
    const { registry, advance, host } = fullRoom();
    markDisconnected(registry, 'socket-guest');

    advance(RECONNECT_GRACE_MS - 1);
    expect(sweep(registry).expiredRooms).toHaveLength(0);
    expect(registry.get(host.room.code)?.guest).not.toBeNull();

    advance(2);
    expect(sweep(registry).expiredRooms).toHaveLength(1);
    expect(registry.get(host.room.code)).toBeUndefined();
  });

  it('removes a room once nobody is attached', () => {
    const { registry, host } = fullRoom();
    markDisconnected(registry, 'socket-host');
    markDisconnected(registry, 'socket-guest');

    expect(sweep(registry).expiredRooms).toHaveLength(1);
    expect(registry.get(host.room.code)).toBeUndefined();
  });

  it('closes the room when the host leaves', () => {
    const { registry, host } = fullRoom();
    const outcome = leaveRoom(registry, 'socket-host');

    expect(outcome?.roomClosed).toBe(true);
    expect(registry.get(host.room.code)).toBeUndefined();
  });

  it('frees the seat and resets the session when the guest leaves', () => {
    const { registry, host } = fullRoom();
    const previousSession = host.room.sessionId;

    const outcome = leaveRoom(registry, 'socket-guest');

    expect(outcome?.roomClosed).toBe(false);
    const room = registry.get(host.room.code);
    expect(room?.guest).toBeNull();
    expect(room?.status).toBe('waiting');
    expect(room?.sessionId).not.toBe(previousSession);
  });
});

describe('capture authorization and progression', () => {
  it('refuses to start until both participants are ready', () => {
    const { registry } = makeRegistry();
    const host = createRoom(registry, 'socket-host');
    joinRoom(registry, 'socket-guest', host.room.code);

    const result = startCapture(registry, host.room, 'event-1');
    expect(result.ok ? null : result.code).toBe('NOT_READY');
  });

  it('schedules shot one in the future when both are ready', () => {
    const { registry, host } = fullRoom();
    const result = startCapture(registry, host.room, 'event-1');

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.countdown.shotNumber).toBe(1);
    expect(result.value.countdown.startAt).toBeGreaterThan(registry.now());
    expect(host.room.status).toBe('capturing');
  });

  it('ignores a duplicate start command', () => {
    const { registry, host } = fullRoom();
    expect(startCapture(registry, host.room, 'event-1').ok).toBe(true);
    expect(startCapture(registry, host.room, 'event-1').ok).toBe(false);
  });

  it('completes a shot only when both participants confirm receipt', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');
    const sessionId = room.sessionId;

    const base = { sessionId, shotNumber: 1 } as const;
    recordCaptureAck(registry, room, 'host', { ...base, eventId: 'a', stage: 'local' });
    recordCaptureAck(registry, room, 'guest', { ...base, eventId: 'b', stage: 'local' });
    expect(room.completedShots).toEqual([]);
    expect(room.shotStatus).toBe('transferring');

    recordCaptureAck(registry, room, 'host', { ...base, eventId: 'c', stage: 'peer-received' });
    expect(room.completedShots).toEqual([]);

    const final = recordCaptureAck(registry, room, 'guest', {
      ...base,
      eventId: 'd',
      stage: 'peer-received',
    });
    expect(room.completedShots).toEqual([1]);
    expect(final.ok && final.value.completedShot).toBe(1);
    expect(final.ok && final.value.nextCountdown?.shotNumber).toBe(2);
  });

  it('ignores a duplicate acknowledgement', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');
    const base = { sessionId: room.sessionId, shotNumber: 1, stage: 'peer-received' } as const;

    recordCaptureAck(registry, room, 'host', { ...base, eventId: 'dup' });
    const replayed = recordCaptureAck(registry, room, 'host', { ...base, eventId: 'dup' });

    expect(replayed.ok && replayed.value.changed).toBe(false);
    expect(room.completedShots).toEqual([]);
  });

  it('rejects an acknowledgement for a stale session', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');

    const result = recordCaptureAck(registry, room, 'host', {
      sessionId: 'stale-session-id',
      shotNumber: 1,
      eventId: 'x',
      stage: 'local',
    });

    expect(result.ok ? null : result.code).toBe('SESSION_MISMATCH');
  });

  it('marks the session complete after every shot and offers no next countdown', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');

    let last: ReturnType<typeof recordCaptureAck> | null = null;
    for (let shot = 1; shot <= SHOTS_PER_SESSION; shot += 1) {
      const base = { sessionId: room.sessionId, shotNumber: shot, stage: 'peer-received' } as const;
      recordCaptureAck(registry, room, 'host', { ...base, eventId: `h${shot}` });
      last = recordCaptureAck(registry, room, 'guest', { ...base, eventId: `g${shot}` });
    }

    expect(room.completedShots).toEqual([1, 2, 3, 4]);
    expect(room.status).toBe('complete');
    expect(last?.ok && last.value.sessionComplete).toBe(true);
    expect(last?.ok && last.value.nextCountdown).toBeNull();
  });

  it('keeps completed shots across a reconnect and resumes at the missing shot', () => {
    const { registry, host, guest } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');

    const base = { sessionId: room.sessionId, shotNumber: 1, stage: 'peer-received' } as const;
    recordCaptureAck(registry, room, 'host', { ...base, eventId: 'h1' });
    recordCaptureAck(registry, room, 'guest', { ...base, eventId: 'g1' });
    const sessionId = room.sessionId;

    markDisconnected(registry, 'socket-guest');
    expect(room.completedShots).toEqual([1]);
    expect(room.shotStatus).toBe('idle');

    const resumed = resumeRoom(registry, 'socket-guest-2', room.code, guest.reconnectToken);
    expect(resumed.ok).toBe(true);
    bothReady(registry, 'socket-host', 'socket-guest-2');

    const restart = startCapture(registry, room, 'event-restart');
    expect(restart.ok && restart.value.countdown.shotNumber).toBe(2);
    expect(restart.ok && restart.value.sessionRestarted).toBe(false);
    // The same session id means the first frame stays valid on both devices.
    expect(room.sessionId).toBe(sessionId);
  });

  it('issues a new session id on retake so stale frames are dropped', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');
    const previousSession = room.sessionId;

    const result = retakeCapture(registry, room, 'event-retake');

    expect(result.ok).toBe(true);
    expect(room.sessionId).not.toBe(previousSession);
    expect(room.completedShots).toEqual([]);
    expect(room.currentShot).toBe(0);
    expect(room.shotStatus).toBe('idle');
  });

  it('starts a fresh session when a finished sequence is run again', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');

    for (let shot = 1; shot <= SHOTS_PER_SESSION; shot += 1) {
      const base = { sessionId: room.sessionId, shotNumber: shot, stage: 'peer-received' } as const;
      recordCaptureAck(registry, room, 'host', { ...base, eventId: `h${shot}` });
      recordCaptureAck(registry, room, 'guest', { ...base, eventId: `g${shot}` });
    }
    const finishedSession = room.sessionId;

    const restart = startCapture(registry, room, 'event-again');
    expect(restart.ok && restart.value.sessionRestarted).toBe(true);
    expect(restart.ok && restart.value.countdown.shotNumber).toBe(1);
    expect(room.sessionId).not.toBe(finishedSession);
  });

  it('aborts the in-flight shot when a camera stops being ready', () => {
    const { registry, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');
    expect(room.shotStatus).toBe('countdown');

    setReady(registry, 'socket-guest', { cameraReady: false, dataChannelReady: false });

    expect(room.shotStatus).toBe('idle');
    expect(room.status).toBe('connecting');
  });

  it('aborts a shot whose stills never finish transferring', () => {
    const { registry, advance, host } = fullRoom();
    const room = host.room;
    startCapture(registry, room, 'event-start');

    advance(CAPTURE_SCHEDULE_LEAD_MS + SHOT_TRANSFER_TIMEOUT_MS + 1);
    const result = sweep(registry);

    expect(result.timedOutShots.map((entry) => entry.shotNumber)).toEqual([1]);
    expect(room.shotStatus).toBe('idle');
    expect(room.completedShots).toEqual([]);
  });
});

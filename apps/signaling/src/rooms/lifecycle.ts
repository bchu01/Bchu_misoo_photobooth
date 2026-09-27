/**
 * Room lifecycle transitions: create, join, resume, leave, readiness, expiry.
 *
 * Every function here is synchronous and side-effect-free apart from mutating
 * the registry it is handed, so the rules can be unit tested without sockets.
 * Socket emission lives in `handlers/`.
 */

import { RECONNECT_GRACE_MS, SHOTS_PER_SESSION } from '@bchu/shared';
import type { ParticipantState, Role, RoomErrorCode, RoomState } from '@bchu/shared';
import { generateReconnectToken, hashToken, tokenMatches } from '../lib/secrets.js';
import {
  bothParticipantsReady,
  createParticipant,
  createProgress,
  isSessionComplete,
  participantFor,
  type Participant,
  type Room,
  type RoomRegistry,
} from './registry.js';

export type Result<T> = { ok: true; value: T } | { ok: false; code: RoomErrorCode };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function fail<T>(code: RoomErrorCode): Result<T> {
  return { ok: false, code };
}

export interface Membership {
  room: Room;
  role: Role;
  /** Raw token, returned to exactly one tab and never stored server-side. */
  reconnectToken: string;
}

function toParticipantState(participant: Participant | null): ParticipantState | null {
  if (!participant) return null;
  return {
    role: participant.role,
    connected: participant.socketId !== null,
    cameraReady: participant.cameraReady,
    dataChannelReady: participant.dataChannelReady,
  };
}

/** The client-facing projection of a room. Contains no tokens or socket ids. */
export function toRoomState(room: Room): RoomState {
  return {
    code: room.code,
    status: room.status,
    expiresAt: room.expiresAt,
    sessionId: room.sessionId,
    currentShot: room.currentShot,
    shotStatus: room.shotStatus,
    completedShots: [...room.completedShots],
    shotsPerSession: SHOTS_PER_SESSION,
    host: toParticipantState(room.host),
    guest: toParticipantState(room.guest),
  };
}

export function isExpired(room: Room, now: number): boolean {
  return room.status === 'expired' || now >= room.expiresAt;
}

/**
 * Derives room status from participant presence and readiness.
 * `capturing` is preserved only while both participants remain ready.
 */
export function recomputeStatus(room: Room): void {
  if (room.status === 'expired') return;

  if (!room.guest) {
    room.status = 'waiting';
    return;
  }

  const ready = bothParticipantsReady(room);

  if (room.status === 'capturing' && ready) return;

  if (isSessionComplete(room)) {
    room.status = 'complete';
    return;
  }

  room.status = ready ? 'ready' : 'connecting';
}

export function resetSession(room: Room, sessionId: string): void {
  room.sessionId = sessionId;
  room.currentShot = 0;
  room.shotStatus = 'idle';
  room.completedShots = [];
  room.shotDeadlineAt = null;
  room.progress = createProgress();
}

export function createRoom(registry: RoomRegistry, socketId: string): Membership {
  const reconnectToken = generateReconnectToken();
  const room = registry.createRoom(socketId, hashToken(reconnectToken));
  return { room, role: 'host', reconnectToken };
}

export function joinRoom(
  registry: RoomRegistry,
  socketId: string,
  code: string,
): Result<Membership> {
  const room = registry.get(code);
  if (!room) return fail('NOT_FOUND');
  if (isExpired(room, registry.now())) return fail('EXPIRED');

  // A partly completed session must not absorb a replacement guest.
  if (room.guest) return fail('FULL');

  const reconnectToken = generateReconnectToken();
  room.guest = createParticipant('guest', socketId, hashToken(reconnectToken), registry.now());
  registry.bindSocket(socketId, room.code, 'guest');
  recomputeStatus(room);

  return ok({ room, role: 'guest', reconnectToken });
}

/**
 * Rebinds a tab to the role it already holds, proven by its opaque token.
 * Idempotent: the same tab may resume after a client-side route change without
 * having disconnected. The token rotates on every success.
 */
export function resumeRoom(
  registry: RoomRegistry,
  socketId: string,
  code: string,
  token: string,
): Result<Membership> {
  const room = registry.get(code);
  if (!room) return fail('NOT_FOUND');
  if (isExpired(room, registry.now())) return fail('EXPIRED');

  const candidates: Participant[] = room.guest ? [room.host, room.guest] : [room.host];
  const participant = candidates.find((entry) => tokenMatches(token, entry.reconnectTokenHash));
  if (!participant) return fail('INVALID_TOKEN');

  if (participant.socketId && participant.socketId !== socketId) {
    registry.releaseSocket(participant.socketId);
  }

  const reconnectToken = generateReconnectToken();
  participant.reconnectTokenHash = hashToken(reconnectToken);
  participant.socketId = socketId;
  participant.disconnectedAt = null;
  participant.lastSeenAt = registry.now();
  // Media must be renegotiated after a rebind, so readiness restarts from false.
  participant.cameraReady = false;
  participant.dataChannelReady = false;

  registry.bindSocket(socketId, room.code, participant.role);
  abortInFlightShot(room);
  recomputeStatus(room);

  return ok({ room, role: participant.role, reconnectToken });
}

export function setReady(
  registry: RoomRegistry,
  socketId: string,
  flags: { cameraReady: boolean; dataChannelReady: boolean },
): Result<{ room: Room; role: Role }> {
  const found = requireMembership(registry, socketId);
  if (!found.ok) return found;

  const { room, role, participant } = found.value;
  participant.cameraReady = flags.cameraReady;
  participant.dataChannelReady = flags.dataChannelReady;
  participant.lastSeenAt = registry.now();

  if (!flags.cameraReady || !flags.dataChannelReady) abortInFlightShot(room);
  recomputeStatus(room);

  return ok({ room, role });
}

export interface MembershipContext {
  room: Room;
  role: Role;
  participant: Participant;
}

/** Resolves a socket to its room membership. The only authorization gate. */
export function requireMembership(
  registry: RoomRegistry,
  socketId: string,
): Result<MembershipContext> {
  const binding = registry.lookupSocket(socketId);
  if (!binding) return fail('NOT_IN_ROOM');

  const room = registry.get(binding.code);
  if (!room) {
    registry.releaseSocket(socketId);
    return fail('NOT_FOUND');
  }
  if (isExpired(room, registry.now())) return fail('EXPIRED');

  const participant = participantFor(room, binding.role);
  if (!participant || participant.socketId !== socketId) return fail('NOT_IN_ROOM');

  return ok({ room, role: binding.role, participant });
}

/** Clears progress for the shot in flight; completed shots are untouched. */
export function abortInFlightShot(room: Room): number | null {
  if (room.shotStatus === 'idle' || room.shotStatus === 'complete') return null;

  const aborted = room.currentShot;
  room.progress.localCaptured.delete(aborted);
  room.progress.peerReceived.delete(aborted);
  room.shotStatus = 'idle';
  room.shotDeadlineAt = null;
  return aborted;
}

export interface DepartureOutcome {
  room: Room;
  role: Role;
  /** True when the room was removed outright rather than held for reconnect. */
  roomClosed: boolean;
  abortedShot: number | null;
}

/**
 * Voluntary leave. The leaver's token is invalidated immediately so it cannot
 * be reused, and a host leaving ends the room for everyone.
 */
export function leaveRoom(registry: RoomRegistry, socketId: string): DepartureOutcome | null {
  const binding = registry.lookupSocket(socketId);
  if (!binding) return null;

  const room = registry.get(binding.code);
  registry.releaseSocket(socketId);
  if (!room) return null;

  const abortedShot = abortInFlightShot(room);

  if (binding.role === 'host') {
    room.status = 'expired';
    registry.delete(room.code);
    return { room, role: 'host', roomClosed: true, abortedShot };
  }

  room.guest = null;
  resetSession(room, registry.createSessionId());
  recomputeStatus(room);
  return { room, role: 'guest', roomClosed: false, abortedShot };
}

/**
 * Transport-level disconnect. The role is held for a grace period so the same
 * tab can resume with its token; no new participant may take the slot.
 */
export function markDisconnected(
  registry: RoomRegistry,
  socketId: string,
): DepartureOutcome | null {
  const binding = registry.lookupSocket(socketId);
  if (!binding) return null;

  const room = registry.get(binding.code);
  registry.releaseSocket(socketId);
  if (!room) return null;

  const participant = participantFor(room, binding.role);
  if (!participant || participant.socketId !== socketId) return null;

  const now = registry.now();
  participant.socketId = null;
  participant.disconnectedAt = now;
  participant.cameraReady = false;
  participant.dataChannelReady = false;

  const abortedShot = abortInFlightShot(room);
  recomputeStatus(room);

  return { room, role: binding.role, roomClosed: false, abortedShot };
}

export interface SweepResult {
  expiredRooms: Room[];
  timedOutShots: Array<{ room: Room; shotNumber: number }>;
}

/**
 * Periodic housekeeping: expire rooms past their TTL or past the reconnect
 * grace period, and abort shots whose stills never finished transferring.
 */
export function sweep(registry: RoomRegistry): SweepResult {
  const now = registry.now();
  const result: SweepResult = { expiredRooms: [], timedOutShots: [] };

  for (const room of registry.all()) {
    const participants = [room.host, room.guest].filter(
      (entry): entry is Participant => entry !== null,
    );
    const graceExpired = participants.some(
      (entry) =>
        entry.disconnectedAt !== null && now - entry.disconnectedAt > RECONNECT_GRACE_MS,
    );
    const everyoneGone = participants.every((entry) => entry.socketId === null);

    if (now >= room.expiresAt || graceExpired || everyoneGone) {
      room.status = 'expired';
      registry.delete(room.code);
      result.expiredRooms.push(room);
      continue;
    }

    if (
      room.shotDeadlineAt !== null &&
      now > room.shotDeadlineAt &&
      (room.shotStatus === 'countdown' || room.shotStatus === 'transferring')
    ) {
      const shotNumber = room.currentShot;
      abortInFlightShot(room);
      recomputeStatus(room);
      result.timedOutShots.push({ room, shotNumber });
    }
  }

  return result;
}

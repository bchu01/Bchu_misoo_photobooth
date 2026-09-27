/**
 * Capture session state machine.
 *
 * The server owns shot progression and scheduling only. Image bytes travel
 * peer-to-peer; the server records acknowledgements so a shot is marked
 * complete only when both participants confirm they hold the peer's still.
 *
 * Scheduling uses an agreed future server timestamp plus a client-estimated
 * clock offset. This aligns countdowns, it does not guarantee frame-level
 * synchronization across the internet.
 */

import {
  CAPTURE_SCHEDULE_LEAD_MS,
  COUNTDOWN_SECONDS,
  INTER_SHOT_PAUSE_MS,
  SHOTS_PER_SESSION,
  SHOT_TRANSFER_TIMEOUT_MS,
} from '@bchu/shared';
import type { AckStage, CaptureCountdownEvent, Role } from '@bchu/shared';
import { bothParticipantsReady, isSessionComplete, type Room, type RoomRegistry } from './registry.js';
import { fail, ok, recomputeStatus, resetSession, type Result } from './lifecycle.js';

/** Keeps the idempotency set from growing without bound in a long session. */
const MAX_TRACKED_EVENT_IDS = 256;

function rememberEvent(room: Room, eventId: string): boolean {
  if (room.progress.seenEventIds.has(eventId)) return false;
  if (room.progress.seenEventIds.size >= MAX_TRACKED_EVENT_IDS) {
    const oldest = room.progress.seenEventIds.values().next();
    if (!oldest.done) room.progress.seenEventIds.delete(oldest.value);
  }
  room.progress.seenEventIds.add(eventId);
  return true;
}

function scheduleShot(registry: RoomRegistry, room: Room, shotNumber: number, pauseMs: number): CaptureCountdownEvent {
  const startAt = registry.now() + pauseMs + CAPTURE_SCHEDULE_LEAD_MS;

  room.status = 'capturing';
  room.currentShot = shotNumber;
  room.shotStatus = 'countdown';
  room.shotDeadlineAt = startAt + SHOT_TRANSFER_TIMEOUT_MS;

  return {
    sessionId: room.sessionId,
    shotNumber,
    startAt,
    countdownSeconds: COUNTDOWN_SECONDS,
  };
}

export interface StartCaptureOutcome {
  countdown: CaptureCountdownEvent;
  /** True when a fresh session id was issued because the last one finished. */
  sessionRestarted: boolean;
}

/**
 * Begins a sequence. Host-only; callers must have already established that the
 * requesting socket holds the host role in this room.
 */
export function startCapture(
  registry: RoomRegistry,
  room: Room,
  eventId: string,
): Result<StartCaptureOutcome> {
  if (!bothParticipantsReady(room)) return fail('NOT_READY');
  if (!rememberEvent(room, eventId)) return fail('SESSION_MISMATCH');

  // A sequence already running must be retaken rather than restarted.
  if (room.status === 'capturing' && room.shotStatus !== 'idle') {
    return fail('SESSION_MISMATCH');
  }

  // A finished session starts over; an interrupted one resumes at the next
  // missing shot so already completed frames stay usable.
  const sessionRestarted = isSessionComplete(room);
  if (sessionRestarted) resetSession(room, registry.createSessionId());

  const nextShot = room.completedShots.length + 1;
  return ok({ countdown: scheduleShot(registry, room, nextShot, 0), sessionRestarted });
}

export function retakeCapture(
  registry: RoomRegistry,
  room: Room,
  eventId: string,
): Result<{ sessionId: string }> {
  if (!rememberEvent(room, eventId)) return fail('SESSION_MISMATCH');

  resetSession(room, registry.createSessionId());
  recomputeStatus(room);
  return ok({ sessionId: room.sessionId });
}

export interface AckOutcome {
  /** False when the ack was a duplicate or did not change any state. */
  changed: boolean;
  /** Set when this ack completed a shot. */
  completedShot: number | null;
  /** Countdown for the following shot, if any. */
  nextCountdown: CaptureCountdownEvent | null;
  sessionComplete: boolean;
}

/**
 * Records one participant's acknowledgement for a shot.
 *
 * `local` means "I captured my own frame". `peer-received` means "I have the
 * other person's frame in full". A shot completes only when both participants
 * report `peer-received`, which implies all eight stills exist for a session.
 */
export function recordCaptureAck(
  registry: RoomRegistry,
  room: Room,
  role: Role,
  payload: { sessionId: string; shotNumber: number; eventId: string; stage: AckStage },
): Result<AckOutcome> {
  if (payload.sessionId !== room.sessionId) return fail('SESSION_MISMATCH');
  if (payload.shotNumber !== room.currentShot) return fail('SESSION_MISMATCH');
  if (room.completedShots.includes(payload.shotNumber)) {
    return ok({ changed: false, completedShot: null, nextCountdown: null, sessionComplete: isSessionComplete(room) });
  }
  if (!rememberEvent(room, payload.eventId)) {
    return ok({ changed: false, completedShot: null, nextCountdown: null, sessionComplete: false });
  }

  const bucket = payload.stage === 'local' ? room.progress.localCaptured : room.progress.peerReceived;
  const roles = bucket.get(payload.shotNumber) ?? new Set<Role>();
  roles.add(role);
  bucket.set(payload.shotNumber, roles);

  if (payload.stage === 'local' && roles.size === 2 && room.shotStatus === 'countdown') {
    room.shotStatus = 'transferring';
  }

  const received = room.progress.peerReceived.get(payload.shotNumber);
  if (payload.stage !== 'peer-received' || !received || received.size < 2) {
    return ok({ changed: true, completedShot: null, nextCountdown: null, sessionComplete: false });
  }

  room.completedShots = [...room.completedShots, payload.shotNumber].sort((a, b) => a - b);
  room.shotStatus = 'complete';
  room.shotDeadlineAt = null;

  const sessionComplete = room.completedShots.length >= SHOTS_PER_SESSION;
  if (sessionComplete) {
    room.status = 'complete';
    room.shotStatus = 'complete';
    room.currentShot = SHOTS_PER_SESSION;
    return ok({ changed: true, completedShot: payload.shotNumber, nextCountdown: null, sessionComplete: true });
  }

  if (!bothParticipantsReady(room)) {
    room.shotStatus = 'idle';
    recomputeStatus(room);
    return ok({ changed: true, completedShot: payload.shotNumber, nextCountdown: null, sessionComplete: false });
  }

  const nextCountdown = scheduleShot(registry, room, payload.shotNumber + 1, INTER_SHOT_PAUSE_MS);
  return ok({ changed: true, completedShot: payload.shotNumber, nextCountdown, sessionComplete: false });
}

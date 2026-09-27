/**
 * The Socket.IO event contract. Both the client and the server type their
 * socket against these interfaces so an event rename breaks the build rather
 * than silently going unhandled at runtime.
 */

import type {
  Ack,
  CaptureAbortReason,
  RoomError,
  RoomMembership,
  RoomState,
  SignalType,
} from './types.js';
import type {
  CaptureAckPayload,
  CaptureFailedPayload,
  CaptureRetakePayload,
  CaptureStartPayload,
  JoinRoomPayload,
  PeerReadyPayload,
  PeerSignalPayload,
  ResumeRoomPayload,
  TimeSyncPayload,
} from './schemas.js';

export interface CaptureCountdownEvent {
  sessionId: string;
  shotNumber: number;
  /** Server-clock timestamp at which both clients should take the frame. */
  startAt: number;
  countdownSeconds: number;
}

export interface CaptureNextEvent {
  sessionId: string;
  completedShot: number;
  /** Null once every shot in the session is complete. */
  nextShotNumber: number | null;
}

export interface CaptureAbortEvent {
  sessionId: string;
  shotNumber: number | null;
  reason: CaptureAbortReason;
}

export interface PeerSignalEvent {
  type: SignalType;
  data: string;
}

export interface ClientToServerEvents {
  'room:create': (payload: unknown, ack: (result: Ack<RoomMembership>) => void) => void;
  'room:join': (payload: JoinRoomPayload, ack: (result: Ack<RoomMembership>) => void) => void;
  'room:resume': (payload: ResumeRoomPayload, ack: (result: Ack<RoomMembership>) => void) => void;
  'room:leave': (payload: unknown, ack: (result: Ack<{ left: boolean }>) => void) => void;
  'peer:signal': (payload: PeerSignalPayload, ack: (result: Ack<{ forwarded: boolean }>) => void) => void;
  'peer:ready': (payload: PeerReadyPayload, ack: (result: Ack<RoomState>) => void) => void;
  'capture:start': (payload: CaptureStartPayload, ack: (result: Ack<{ sessionId: string }>) => void) => void;
  'capture:ack': (payload: CaptureAckPayload, ack: (result: Ack<{ recorded: boolean }>) => void) => void;
  'capture:retake': (payload: CaptureRetakePayload, ack: (result: Ack<{ sessionId: string }>) => void) => void;
  'capture:failed': (payload: CaptureFailedPayload, ack: (result: Ack<{ aborted: boolean }>) => void) => void;
  'time:sync': (payload: TimeSyncPayload, ack: (result: Ack<{ serverTime: number }>) => void) => void;
}

export interface ServerToClientEvents {
  'room:state': (state: RoomState) => void;
  'room:error': (error: RoomError) => void;
  'peer:signal': (event: PeerSignalEvent) => void;
  'capture:countdown': (event: CaptureCountdownEvent) => void;
  'capture:next': (event: CaptureNextEvent) => void;
  'capture:abort': (event: CaptureAbortEvent) => void;
}

/** Server-side socket metadata. Authorization is read from here, never from payloads. */
export interface SocketData {
  code: string | null;
  role: 'host' | 'guest' | null;
}

export const ROOM_ERROR_MESSAGES: Record<RoomError['code'], string> = {
  INVALID_PAYLOAD: 'That request was not understood. Please try again.',
  INVALID_CODE: 'Room codes are six letters or numbers.',
  NOT_FOUND: 'No room with that code. Check the code and try again.',
  FULL: 'That room already has two people in it.',
  EXPIRED: 'That room has expired. Create a new one.',
  INVALID_TOKEN: 'This tab is no longer part of that room.',
  NOT_IN_ROOM: 'You are not in a room.',
  NOT_HOST: 'Only the host can control the photo sequence.',
  NOT_READY: 'Both cameras and the peer connection must be ready first.',
  PEER_MISSING: 'Your friend is not connected right now.',
  SESSION_MISMATCH: 'That photo session is no longer current.',
  RATE_LIMITED: 'Too many attempts. Wait a moment and try again.',
  INTERNAL: 'Something went wrong on the server.',
};

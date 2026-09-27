/**
 * The single in-memory room registry.
 *
 * This is the whole persistence layer for the MVP: rooms are transient and a
 * process restart drops every session. See DATABASE_DESIGN.md — do not deploy
 * more than one instance against this design.
 *
 * Image bytes never reach this module. Rooms hold coordination state only.
 */

import { ROOM_TTL_MS, SHOTS_PER_SESSION } from '@bchu/shared';
import type { Role, RoomStatus, ShotStatus } from '@bchu/shared';
import { generateRoomCode } from '../lib/secrets.js';

export interface Participant {
  socketId: string | null;
  role: Role;
  /** Only the hash is retained; the raw token lives in the participant's tab. */
  reconnectTokenHash: string;
  cameraReady: boolean;
  dataChannelReady: boolean;
  lastSeenAt: number;
  disconnectedAt: number | null;
}

export interface CaptureProgress {
  /** Shot number -> roles that captured their own still. */
  localCaptured: Map<number, Set<Role>>;
  /** Shot number -> roles that received and verified the peer's still. */
  peerReceived: Map<number, Set<Role>>;
  /** Bounded set of handled event ids, for idempotent command handling. */
  seenEventIds: Set<string>;
}

export interface Room {
  code: string;
  createdAt: number;
  expiresAt: number;
  status: RoomStatus;
  host: Participant;
  guest: Participant | null;
  sessionId: string;
  /** 0 before capture, then 1..SHOTS_PER_SESSION. */
  currentShot: number;
  shotStatus: ShotStatus;
  completedShots: number[];
  /** Server-clock deadline for the in-flight shot, or null when idle. */
  shotDeadlineAt: number | null;
  progress: CaptureProgress;
}

export interface SocketBinding {
  code: string;
  role: Role;
}

export interface RegistryOptions {
  now?: () => number;
  generateCode?: () => string;
  newSessionId?: () => string;
  /** Guards against a pathological code-collision loop. */
  maxCodeAttempts?: number;
}

export function createProgress(): CaptureProgress {
  return {
    localCaptured: new Map(),
    peerReceived: new Map(),
    seenEventIds: new Set(),
  };
}

export function createParticipant(
  role: Role,
  socketId: string,
  reconnectTokenHash: string,
  now: number,
): Participant {
  return {
    socketId,
    role,
    reconnectTokenHash,
    cameraReady: false,
    dataChannelReady: false,
    lastSeenAt: now,
    disconnectedAt: null,
  };
}

export class RoomRegistry {
  private readonly rooms = new Map<string, Room>();
  private readonly socketIndex = new Map<string, SocketBinding>();

  readonly now: () => number;
  private readonly generateCode: () => string;
  private readonly newSessionId: () => string;
  private readonly maxCodeAttempts: number;

  constructor(options: RegistryOptions = {}) {
    this.now = options.now ?? (() => Date.now());
    this.generateCode = options.generateCode ?? generateRoomCode;
    this.newSessionId = options.newSessionId ?? (() => crypto.randomUUID());
    this.maxCodeAttempts = options.maxCodeAttempts ?? 20;
  }

  createSessionId(): string {
    return this.newSessionId();
  }

  /** Retries on collision so a reused code can never hijack a live room. */
  allocateCode(): string {
    for (let attempt = 0; attempt < this.maxCodeAttempts; attempt += 1) {
      const code = this.generateCode();
      if (!this.rooms.has(code)) return code;
    }
    throw new Error('Unable to allocate an unused room code.');
  }

  insert(room: Room): Room {
    this.rooms.set(room.code, room);
    return room;
  }

  createRoom(hostSocketId: string, hostTokenHash: string): Room {
    const now = this.now();
    const code = this.allocateCode();
    const room: Room = {
      code,
      createdAt: now,
      expiresAt: now + ROOM_TTL_MS,
      status: 'waiting',
      host: createParticipant('host', hostSocketId, hostTokenHash, now),
      guest: null,
      sessionId: this.newSessionId(),
      currentShot: 0,
      shotStatus: 'idle',
      completedShots: [],
      shotDeadlineAt: null,
      progress: createProgress(),
    };
    this.insert(room);
    this.bindSocket(hostSocketId, code, 'host');
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(code);
  }

  delete(code: string): void {
    const room = this.rooms.get(code);
    if (!room) return;
    for (const participant of [room.host, room.guest]) {
      if (participant?.socketId) this.socketIndex.delete(participant.socketId);
    }
    this.rooms.delete(code);
  }

  bindSocket(socketId: string, code: string, role: Role): void {
    this.socketIndex.set(socketId, { code, role });
  }

  releaseSocket(socketId: string): void {
    this.socketIndex.delete(socketId);
  }

  /** The only trustworthy source of a socket's room and role. */
  lookupSocket(socketId: string): SocketBinding | undefined {
    return this.socketIndex.get(socketId);
  }

  all(): Room[] {
    return [...this.rooms.values()];
  }

  get size(): number {
    return this.rooms.size;
  }
}

export function participantFor(room: Room, role: Role): Participant | null {
  return role === 'host' ? room.host : room.guest;
}

export function peerRole(role: Role): Role {
  return role === 'host' ? 'guest' : 'host';
}

export function peerOf(room: Room, role: Role): Participant | null {
  return participantFor(room, peerRole(role));
}

export function isParticipantReady(participant: Participant | null): boolean {
  return Boolean(
    participant &&
      participant.socketId !== null &&
      participant.cameraReady &&
      participant.dataChannelReady,
  );
}

export function bothParticipantsReady(room: Room): boolean {
  return isParticipantReady(room.host) && isParticipantReady(room.guest);
}

export function isSessionComplete(room: Room): boolean {
  return room.completedShots.length >= SHOTS_PER_SESSION;
}

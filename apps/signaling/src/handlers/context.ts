/** Shared socket types and broadcast helpers used by every handler module. */

import type { Server, Socket } from 'socket.io';
import type {
  ClientToServerEvents,
  Role,
  RoomErrorCode,
  ServerToClientEvents,
  SocketData,
} from '@bchu/shared';
import { ROOM_ERROR_MESSAGES } from '@bchu/shared';
import type { RoomRegistry, Room } from '../rooms/registry.js';
import { participantFor } from '../rooms/registry.js';
import { toRoomState } from '../rooms/lifecycle.js';
import type { RateLimiter } from '../middleware/rateLimit.js';

// eslint-disable-next-line @typescript-eslint/no-empty-object-type
type InterServerEvents = {};

export type TypedServer = Server<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export type TypedSocket = Socket<
  ClientToServerEvents,
  ServerToClientEvents,
  InterServerEvents,
  SocketData
>;

export interface HandlerContext {
  io: TypedServer;
  registry: RoomRegistry;
  rateLimiter: RateLimiter;
}

/** Socket.IO transport room name. Kept separate from the user-facing code. */
export function transportRoom(code: string): string {
  return `room:${code}`;
}

/** Sends the authoritative snapshot to everyone still attached to the room. */
export function broadcastRoomState(io: TypedServer, room: Room): void {
  io.to(transportRoom(room.code)).emit('room:state', toRoomState(room));
}

export function emitToRole(io: TypedServer, room: Room, role: Role): TypedServer | null {
  const participant = participantFor(room, role);
  if (!participant?.socketId) return null;
  return io.to(participant.socketId) as unknown as TypedServer;
}

export function emitRoomError(socket: TypedSocket, code: RoomErrorCode): void {
  socket.emit('room:error', { code, message: ROOM_ERROR_MESSAGES[code] });
}

/** Client address used for rate limiting. Behind a proxy, trust the proxy config. */
export function clientKey(socket: TypedSocket): string {
  const forwarded = socket.handshake.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length > 0) {
    return forwarded.split(',')[0]?.trim() ?? socket.handshake.address;
  }
  return socket.handshake.address;
}

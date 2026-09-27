/** Room membership events: create, join, resume, leave, readiness, disconnect. */

import {
  emptyPayloadSchema,
  joinRoomSchema,
  peerReadySchema,
  resumeRoomSchema,
} from '@bchu/shared';
import type { RoomMembership } from '@bchu/shared';
import { logger, redactCode } from '../lib/logger.js';
import { failure, parsePayload, reply, success } from '../lib/respond.js';
import {
  createRoom,
  joinRoom,
  leaveRoom,
  markDisconnected,
  resumeRoom,
  setReady,
  toRoomState,
  type Membership,
} from '../rooms/lifecycle.js';
import {
  broadcastRoomState,
  clientKey,
  transportRoom,
  type HandlerContext,
  type TypedSocket,
} from './context.js';

function toMembershipAck(membership: Membership): RoomMembership {
  return {
    code: membership.room.code,
    role: membership.role,
    reconnectToken: membership.reconnectToken,
    expiresAt: membership.room.expiresAt,
    state: toRoomState(membership.room),
  };
}

/** Sockets hold at most one membership, so any prior room is released first. */
function detachFromCurrentRoom(context: HandlerContext, socket: TypedSocket): void {
  const binding = context.registry.lookupSocket(socket.id);
  if (!binding) return;

  const outcome = leaveRoom(context.registry, socket.id);
  void socket.leave(transportRoom(binding.code));
  if (outcome && !outcome.roomClosed) broadcastRoomState(context.io, outcome.room);
}

function attach(context: HandlerContext, socket: TypedSocket, membership: Membership): void {
  socket.data.code = membership.room.code;
  socket.data.role = membership.role;
  void socket.join(transportRoom(membership.room.code));
}

export function registerRoomHandlers(context: HandlerContext, socket: TypedSocket): void {
  const { io, registry, rateLimiter } = context;

  socket.on('room:create', (payload, ack) => {
    if (parsePayload(emptyPayloadSchema, payload, ack, 'room:create') === null) return;
    if (!rateLimiter.consume(clientKey(socket), 'room:create')) {
      reply(ack, failure('RATE_LIMITED'));
      return;
    }

    detachFromCurrentRoom(context, socket);

    const membership = createRoom(registry, socket.id);
    attach(context, socket, membership);

    logger.info('room created', { code: redactCode(membership.room.code) });
    reply(ack, success(toMembershipAck(membership)));
    broadcastRoomState(io, membership.room);
  });

  socket.on('room:join', (payload, ack) => {
    const parsed = parsePayload(joinRoomSchema, payload, ack, 'room:join');
    if (!parsed) return;
    if (!rateLimiter.consume(clientKey(socket), 'room:join')) {
      reply(ack, failure('RATE_LIMITED'));
      return;
    }

    detachFromCurrentRoom(context, socket);

    const result = joinRoom(registry, socket.id, parsed.code);
    if (!result.ok) {
      logger.info('join rejected', { code: redactCode(parsed.code), reason: result.code });
      reply(ack, failure(result.code));
      return;
    }

    attach(context, socket, result.value);
    reply(ack, success(toMembershipAck(result.value)));
    broadcastRoomState(io, result.value.room);
  });

  socket.on('room:resume', (payload, ack) => {
    const parsed = parsePayload(resumeRoomSchema, payload, ack, 'room:resume');
    if (!parsed) return;
    if (!rateLimiter.consume(clientKey(socket), 'room:resume')) {
      reply(ack, failure('RATE_LIMITED'));
      return;
    }

    const existing = registry.lookupSocket(socket.id);
    if (existing && existing.code !== parsed.code) detachFromCurrentRoom(context, socket);

    const result = resumeRoom(registry, socket.id, parsed.code, parsed.reconnectToken);
    if (!result.ok) {
      reply(ack, failure(result.code));
      return;
    }

    attach(context, socket, result.value);
    reply(ack, success(toMembershipAck(result.value)));
    broadcastRoomState(io, result.value.room);
  });

  socket.on('room:leave', (payload, ack) => {
    if (parsePayload(emptyPayloadSchema, payload, ack, 'room:leave') === null) return;

    const binding = registry.lookupSocket(socket.id);
    const outcome = leaveRoom(registry, socket.id);

    if (binding) void socket.leave(transportRoom(binding.code));
    socket.data.code = null;
    socket.data.role = null;

    reply(ack, success({ left: outcome !== null }));
    if (!outcome) return;

    if (outcome.roomClosed) {
      io.to(transportRoom(outcome.room.code)).emit('capture:abort', {
        sessionId: outcome.room.sessionId,
        shotNumber: outcome.abortedShot,
        reason: 'peer-left',
      });
      io.to(transportRoom(outcome.room.code)).emit('room:state', {
        ...toRoomState(outcome.room),
        status: 'expired',
      });
      return;
    }

    if (outcome.abortedShot !== null) {
      io.to(transportRoom(outcome.room.code)).emit('capture:abort', {
        sessionId: outcome.room.sessionId,
        shotNumber: outcome.abortedShot,
        reason: 'peer-left',
      });
    }
    broadcastRoomState(io, outcome.room);
  });

  socket.on('peer:ready', (payload, ack) => {
    const parsed = parsePayload(peerReadySchema, payload, ack, 'peer:ready');
    if (!parsed) return;

    const result = setReady(registry, socket.id, parsed);
    if (!result.ok) {
      reply(ack, failure(result.code));
      return;
    }

    reply(ack, success(toRoomState(result.value.room)));
    broadcastRoomState(io, result.value.room);
  });

  socket.on('disconnect', (reason) => {
    const outcome = markDisconnected(registry, socket.id);
    if (!outcome) return;

    logger.info('participant disconnected', {
      code: redactCode(outcome.room.code),
      role: outcome.role,
      reason,
    });

    if (outcome.abortedShot !== null) {
      io.to(transportRoom(outcome.room.code)).emit('capture:abort', {
        sessionId: outcome.room.sessionId,
        shotNumber: outcome.abortedShot,
        reason: 'peer-left',
      });
    }
    broadcastRoomState(io, outcome.room);
  });
}

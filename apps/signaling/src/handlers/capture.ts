/**
 * Capture orchestration events.
 *
 * Only the host may start or retake, and the server re-derives the role from
 * socket membership rather than trusting anything in the payload.
 */

import {
  captureAckSchema,
  captureFailedSchema,
  captureRetakeSchema,
  captureStartSchema,
  timeSyncSchema,
} from '@bchu/shared';
import { logger, redactCode } from '../lib/logger.js';
import { failure, parsePayload, reply, success } from '../lib/respond.js';
import { abortInFlightShot, recomputeStatus, requireMembership } from '../rooms/lifecycle.js';
import { recordCaptureAck, retakeCapture, startCapture } from '../rooms/captureSession.js';
import {
  broadcastRoomState,
  transportRoom,
  type HandlerContext,
  type TypedSocket,
} from './context.js';

export function registerCaptureHandlers(context: HandlerContext, socket: TypedSocket): void {
  const { io, registry } = context;

  socket.on('time:sync', (payload, ack) => {
    if (parsePayload(timeSyncSchema, payload, ack, 'time:sync') === null) return;
    reply(ack, success({ serverTime: registry.now() }));
  });

  socket.on('capture:start', (payload, ack) => {
    const parsed = parsePayload(captureStartSchema, payload, ack, 'capture:start');
    if (!parsed) return;

    const membership = requireMembership(registry, socket.id);
    if (!membership.ok) {
      reply(ack, failure(membership.code));
      return;
    }
    if (membership.value.role !== 'host') {
      reply(ack, failure('NOT_HOST'));
      return;
    }

    const room = membership.value.room;
    const result = startCapture(registry, room, parsed.eventId);
    if (!result.ok) {
      reply(ack, failure(result.code));
      return;
    }

    logger.info('capture sequence started', {
      code: redactCode(room.code),
      shot: result.value.countdown.shotNumber,
    });

    reply(ack, success({ sessionId: room.sessionId }));
    broadcastRoomState(io, room);
    io.to(transportRoom(room.code)).emit('capture:countdown', result.value.countdown);
  });

  socket.on('capture:retake', (payload, ack) => {
    const parsed = parsePayload(captureRetakeSchema, payload, ack, 'capture:retake');
    if (!parsed) return;

    const membership = requireMembership(registry, socket.id);
    if (!membership.ok) {
      reply(ack, failure(membership.code));
      return;
    }
    if (membership.value.role !== 'host') {
      reply(ack, failure('NOT_HOST'));
      return;
    }

    const room = membership.value.room;
    const previousSessionId = room.sessionId;
    const previousShot = room.currentShot;
    const result = retakeCapture(registry, room, parsed.eventId);
    if (!result.ok) {
      reply(ack, failure(result.code));
      return;
    }

    reply(ack, success({ sessionId: result.value.sessionId }));
    // Both clients drop their frames for the retired session id.
    io.to(transportRoom(room.code)).emit('capture:abort', {
      sessionId: previousSessionId,
      shotNumber: previousShot === 0 ? null : previousShot,
      reason: 'host-retake',
    });
    broadcastRoomState(io, room);
  });

  socket.on('capture:ack', (payload, ack) => {
    const parsed = parsePayload(captureAckSchema, payload, ack, 'capture:ack');
    if (!parsed) return;

    const membership = requireMembership(registry, socket.id);
    if (!membership.ok) {
      reply(ack, failure(membership.code));
      return;
    }

    const room = membership.value.room;
    const result = recordCaptureAck(registry, room, membership.value.role, parsed);
    if (!result.ok) {
      reply(ack, failure(result.code));
      return;
    }

    reply(ack, success({ recorded: result.value.changed }));
    if (!result.value.changed) return;

    broadcastRoomState(io, room);

    if (result.value.completedShot !== null) {
      io.to(transportRoom(room.code)).emit('capture:next', {
        sessionId: room.sessionId,
        completedShot: result.value.completedShot,
        nextShotNumber: result.value.nextCountdown?.shotNumber ?? null,
      });
    }

    if (result.value.nextCountdown) {
      io.to(transportRoom(room.code)).emit('capture:countdown', result.value.nextCountdown);
      broadcastRoomState(io, room);
    }
  });

  socket.on('capture:failed', (payload, ack) => {
    const parsed = parsePayload(captureFailedSchema, payload, ack, 'capture:failed');
    if (!parsed) return;

    const membership = requireMembership(registry, socket.id);
    if (!membership.ok) {
      reply(ack, failure(membership.code));
      return;
    }

    const room = membership.value.room;
    if (parsed.sessionId !== room.sessionId) {
      reply(ack, failure('SESSION_MISMATCH'));
      return;
    }

    const abortedShot = abortInFlightShot(room);
    recomputeStatus(room);

    reply(ack, success({ aborted: abortedShot !== null }));
    io.to(transportRoom(room.code)).emit('capture:abort', {
      sessionId: room.sessionId,
      shotNumber: abortedShot ?? parsed.shotNumber,
      reason: parsed.reason,
    });
    broadcastRoomState(io, room);
  });
}

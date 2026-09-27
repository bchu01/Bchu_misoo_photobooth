/**
 * WebRTC signaling relay.
 *
 * Forwards size-bounded SDP and ICE payloads between the two members of one
 * room. The bodies are opaque to the server, and this path carries no media or
 * image bytes by design.
 */

import { peerSignalSchema } from '@bchu/shared';
import { failure, parsePayload, reply, success } from '../lib/respond.js';
import { requireMembership } from '../rooms/lifecycle.js';
import { peerOf } from '../rooms/registry.js';
import type { HandlerContext, TypedSocket } from './context.js';

export function registerPeerHandlers(context: HandlerContext, socket: TypedSocket): void {
  const { io, registry } = context;

  socket.on('peer:signal', (payload, ack) => {
    const parsed = parsePayload(peerSignalSchema, payload, ack, 'peer:signal');
    if (!parsed) return;

    const membership = requireMembership(registry, socket.id);
    if (!membership.ok) {
      reply(ack, failure(membership.code));
      return;
    }

    const peer = peerOf(membership.value.room, membership.value.role);
    if (!peer?.socketId) {
      reply(ack, failure('PEER_MISSING'));
      return;
    }

    io.to(peer.socketId).emit('peer:signal', { type: parsed.type, data: parsed.data });
    reply(ack, success({ forwarded: true }));
  });
}

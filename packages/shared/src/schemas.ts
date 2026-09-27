/**
 * Runtime validation for every payload crossing the network boundary.
 *
 * The server validates all inbound payloads with these schemas. A valid
 * payload still proves nothing about authorization: room membership, role, and
 * session identity are always re-derived from the authenticated socket.
 */

import { z } from 'zod';
import {
  MAX_SIGNAL_PAYLOAD_BYTES,
  MAX_STILL_BYTES,
  ROOM_CODE_LENGTH,
  ROOM_CODE_PATTERN,
  SHOTS_PER_SESSION,
} from './constants.js';

export const roomCodeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .length(ROOM_CODE_LENGTH)
  .regex(ROOM_CODE_PATTERN, 'Room codes are six letters or numbers.');

export const reconnectTokenSchema = z.string().min(16).max(256);

export const sessionIdSchema = z.uuid();

export const shotNumberSchema = z.number().int().min(1).max(SHOTS_PER_SESSION);

export const eventIdSchema = z.string().min(8).max(64);

/** `room:create` and `room:leave` carry no data; anything sent is discarded. */
export const emptyPayloadSchema = z.unknown().transform(() => ({}));

export const joinRoomSchema = z.object({ code: roomCodeSchema });

export const resumeRoomSchema = z.object({
  code: roomCodeSchema,
  reconnectToken: reconnectTokenSchema,
});

/**
 * SDP and ICE bodies are forwarded opaquely but size-bounded, so the signaling
 * service can never be used to relay bulk data such as image bytes.
 */
export const peerSignalSchema = z.object({
  type: z.enum(['offer', 'answer', 'ice']),
  data: z
    .string()
    .max(MAX_SIGNAL_PAYLOAD_BYTES, 'Signal payload too large.')
    .describe('JSON-encoded RTCSessionDescriptionInit or RTCIceCandidateInit'),
});

export const peerReadySchema = z.object({
  cameraReady: z.boolean(),
  dataChannelReady: z.boolean(),
});

export const captureStartSchema = z.object({
  eventId: eventIdSchema,
});

export const captureAckSchema = z.object({
  sessionId: sessionIdSchema,
  shotNumber: shotNumberSchema,
  eventId: eventIdSchema,
  stage: z.enum(['local', 'peer-received']),
});

export const captureRetakeSchema = z.object({
  eventId: eventIdSchema,
});

export const captureFailedSchema = z.object({
  sessionId: sessionIdSchema,
  shotNumber: shotNumberSchema,
  reason: z.enum(['transfer-timeout', 'camera-lost']),
});

export const timeSyncSchema = z.object({
  clientTime: z.number().finite(),
});

/** Guards the data channel, which is peer-to-peer and equally untrusted. */
export const stillBeginSchema = z.object({
  kind: z.literal('still-begin'),
  transferSeq: z.number().int().min(0),
  sessionId: sessionIdSchema,
  shotNumber: shotNumberSchema,
  role: z.enum(['host', 'guest']),
  mimeType: z.literal('image/jpeg'),
  byteSize: z.number().int().min(1).max(MAX_STILL_BYTES),
  chunkCount: z.number().int().min(1).max(4096),
  checksum: z.number().int(),
});

export const stillAckSchema = z.object({
  kind: z.literal('still-ack'),
  transferSeq: z.number().int().min(0),
  sessionId: sessionIdSchema,
  shotNumber: shotNumberSchema,
  ok: z.boolean(),
});

export const stillResetSchema = z.object({
  kind: z.literal('still-reset'),
  sessionId: sessionIdSchema,
});

export const stillControlSchema = z.discriminatedUnion('kind', [
  stillBeginSchema,
  stillAckSchema,
  stillResetSchema,
]);

export type JoinRoomPayload = z.infer<typeof joinRoomSchema>;
export type ResumeRoomPayload = z.infer<typeof resumeRoomSchema>;
export type PeerSignalPayload = z.infer<typeof peerSignalSchema>;
export type PeerReadyPayload = z.infer<typeof peerReadySchema>;
export type CaptureStartPayload = z.infer<typeof captureStartSchema>;
export type CaptureAckPayload = z.infer<typeof captureAckSchema>;
export type CaptureRetakePayload = z.infer<typeof captureRetakeSchema>;
export type CaptureFailedPayload = z.infer<typeof captureFailedSchema>;
export type TimeSyncPayload = z.infer<typeof timeSyncSchema>;

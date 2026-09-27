/**
 * Cross-cutting constants shared by the web client and the signaling service.
 *
 * Visual/strip layout constants intentionally live in the web app
 * (`features/strip/stripLayout.ts`) so the later Figma pass has a single file
 * to replace without touching protocol values.
 */

/** Human-enterable room codes: fixed length, unambiguous uppercase alphabet. */
export const ROOM_CODE_LENGTH = 6;

/** Excludes 0/O/1/I/L and lowercase to survive being read aloud or retyped. */
export const ROOM_CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';

export const ROOM_CODE_PATTERN = new RegExp(`^[${ROOM_CODE_ALPHABET}]{${ROOM_CODE_LENGTH}}$`);

/** Absolute room lifetime. A room is swept once it passes this age. */
export const ROOM_TTL_MS = 30 * 60 * 1000;

/** How long a disconnected participant keeps its role before the room expires. */
export const RECONNECT_GRACE_MS = 60 * 1000;

/** How often the server sweeps expired/abandoned rooms. */
export const ROOM_SWEEP_INTERVAL_MS = 10 * 1000;

/** Exactly one host plus one guest. */
export const ROOM_CAPACITY = 2;

/** Frames in one photo strip session. */
export const SHOTS_PER_SESSION = 4;

/** Visible countdown before each capture. */
export const COUNTDOWN_SECONDS = 3;

/**
 * Extra lead time added to a scheduled capture so both clients receive the
 * command before the countdown starts. This is scheduling headroom, not a
 * promise of frame-level synchronization.
 */
export const CAPTURE_SCHEDULE_LEAD_MS = COUNTDOWN_SECONDS * 1000 + 700;

/** Pause after a completed shot before the next countdown begins. */
export const INTER_SHOT_PAUSE_MS = 900;

/** A shot aborts if both stills have not transferred within this window. */
export const SHOT_TRANSFER_TIMEOUT_MS = 25 * 1000;

/** Round trips used to estimate the client/server clock offset. */
export const CLOCK_SYNC_SAMPLES = 5;

/** Hard ceiling for one still image moved across the data channel. */
export const MAX_STILL_BYTES = 900 * 1024;

/** Data channel messages stay under the widely portable 16 KiB limit. */
export const MAX_DATA_CHANNEL_MESSAGE_BYTES = 16 * 1024;

/** `[uint32 transferSeq][uint32 chunkIndex]` prefix on every binary chunk. */
export const STILL_CHUNK_HEADER_BYTES = 8;

export const STILL_CHUNK_PAYLOAD_BYTES =
  MAX_DATA_CHANNEL_MESSAGE_BYTES - STILL_CHUNK_HEADER_BYTES;

/** Pause sending while the channel has this many bytes queued. */
export const DATA_CHANNEL_HIGH_WATER_BYTES = 8 * STILL_CHUNK_PAYLOAD_BYTES;

/** Upper bound on a single SDP/ICE signal forwarded by the server. */
export const MAX_SIGNAL_PAYLOAD_BYTES = 16 * 1024;

/** Label of the single RTCDataChannel used for still transfer. */
export const STILL_CHANNEL_LABEL = 'bchu-stills';

/** Token bucket limits applied per client IP at the socket boundary. */
export const RATE_LIMITS = {
  'room:create': { tokens: 5, refillPerMinute: 5 },
  'room:join': { tokens: 10, refillPerMinute: 10 },
  'room:resume': { tokens: 20, refillPerMinute: 20 },
} as const;

export type RateLimitedEvent = keyof typeof RATE_LIMITS;

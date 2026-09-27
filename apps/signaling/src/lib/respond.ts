/**
 * Boundary helpers: validate an inbound payload, then answer with a typed ack.
 *
 * Handlers never receive unvalidated data and never throw across the socket.
 */

import type { z } from 'zod';
import { ROOM_ERROR_MESSAGES } from '@bchu/shared';
import type { Ack, RoomErrorCode } from '@bchu/shared';
import { logger } from './logger.js';

export function success<T>(data: T): Ack<T> {
  return { ok: true, data };
}

export function failure<T>(code: RoomErrorCode, message?: string): Ack<T> {
  return { ok: false, error: { code, message: message ?? ROOM_ERROR_MESSAGES[code] } };
}

/** Acks are optional on the wire; a missing callback must not crash the server. */
export type AckFn<T> = (result: Ack<T>) => void;

export function reply<T>(ack: unknown, result: Ack<T>): void {
  if (typeof ack === 'function') (ack as AckFn<T>)(result);
}

/**
 * Parses a payload and replies with INVALID_PAYLOAD on failure.
 * Validation messages are not echoed back verbatim, only a stable code.
 */
export function parsePayload<S extends z.ZodType>(
  schema: S,
  payload: unknown,
  ack: unknown,
  event: string,
): z.infer<S> | null {
  const parsed = schema.safeParse(payload);
  if (parsed.success) return parsed.data as z.infer<S>;

  logger.warn('rejected invalid payload', { event });
  reply(ack, failure('INVALID_PAYLOAD'));
  return null;
}

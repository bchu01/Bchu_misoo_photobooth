'use client';

/**
 * One Socket.IO client for the whole tab.
 *
 * A singleton keeps membership alive across a client-side navigation from the
 * Pair lobby into a room, so joining does not have to survive a disconnect.
 */

import { io, type Socket } from 'socket.io-client';
import type { Ack, ClientToServerEvents, RoomError, ServerToClientEvents } from '@bchu/shared';
import { SIGNALING_URL } from './env';

export type PhotoboothSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: PhotoboothSocket | null = null;

export function getSocket(): PhotoboothSocket {
  if (!socket) {
    socket = io(SIGNALING_URL, {
      autoConnect: false,
      // WebSocket first; polling remains as a fallback for hostile networks.
      transports: ['websocket', 'polling'],
      reconnectionAttempts: 5,
      reconnectionDelay: 500,
    });
  }
  return socket;
}

/**
 * Connects on demand and resolves once the transport is up, so Home and Settings
 * never open a socket at all.
 */
export function ensureConnected(socket: PhotoboothSocket, timeoutMs = 8000): Promise<PhotoboothSocket> {
  if (socket.connected) return Promise.resolve(socket);

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new RequestError('TIMEOUT', UNREACHABLE_MESSAGE));
    }, timeoutMs);

    function cleanup(): void {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    }
    function onConnect(): void {
      cleanup();
      resolve(socket);
    }
    function onError(): void {
      cleanup();
      reject(new RequestError('TIMEOUT', UNREACHABLE_MESSAGE));
    }

    socket.once('connect', onConnect);
    socket.once('connect_error', onError);
    socket.connect();
  });
}

const UNREACHABLE_MESSAGE = 'Could not reach the photobooth server. Check your connection.';

/** Payload type for an event, taken straight from the shared contract. */
export type RequestPayload<Event extends keyof ClientToServerEvents> =
  Parameters<ClientToServerEvents[Event]>[0];

/** Ack data type for an event, so call sites never restate it. */
export type RequestResult<Event extends keyof ClientToServerEvents> =
  Parameters<Parameters<ClientToServerEvents[Event]>[1]>[0] extends Ack<infer Data> ? Data : never;

/** Carries the server's error code so callers can react to specific failures. */
export class RequestError extends Error {
  constructor(
    readonly code: RoomError['code'] | 'TIMEOUT',
    message: string,
  ) {
    super(message);
    this.name = 'RequestError';
  }
}

/**
 * Wraps an ack-style emit in a promise with a bounded wait.
 *
 * The generic emit signature is too strict to satisfy positionally, so the
 * loosening happens here once rather than at every call site.
 */
interface AckEmitter {
  timeout(ms: number): {
    emit(
      event: string,
      payload: unknown,
      ack: (transportError: Error | null, result: unknown) => void,
    ): void;
  };
}

export function request<Event extends keyof ClientToServerEvents>(
  target: PhotoboothSocket,
  event: Event,
  payload: RequestPayload<Event>,
  timeoutMs = 8000,
): Promise<RequestResult<Event>> {
  return new Promise((resolve, reject) => {
    (target as unknown as AckEmitter)
      .timeout(timeoutMs)
      .emit(event as string, payload, (transportError, result) => {
        if (transportError) {
          reject(new RequestError('TIMEOUT', UNREACHABLE_MESSAGE));
          return;
        }

        const ack = result as Ack<RequestResult<Event>> | undefined;
        if (ack?.ok) {
          resolve(ack.data);
          return;
        }

        reject(
          new RequestError(
            ack?.error?.code ?? 'INTERNAL',
            ack?.error?.message ?? 'That request was rejected.',
          ),
        );
      });
  });
}

/**
 * Builds the signaling service.
 *
 * Responsibilities: room codes, two-person capacity, reconnect and expiry,
 * socket authorization, WebRTC signal forwarding, capture orchestration.
 *
 * Explicit non-responsibilities: it never receives image bytes, never relays
 * media, and holds no state that survives a restart.
 *
 * Exposed as a factory so tests can run a real server on an ephemeral port.
 */

import { createServer, type IncomingMessage, type Server as HttpServer, type ServerResponse } from 'node:http';
import { Server } from 'socket.io';
import { ROOM_SWEEP_INTERVAL_MS } from '@bchu/shared';
import type { AppConfig } from './config.js';
import { buildIceConfig } from './ice.js';
import { logger, redactCode } from './lib/logger.js';
import { RateLimiter } from './middleware/rateLimit.js';
import { RoomRegistry, type RegistryOptions } from './rooms/registry.js';
import { sweep, toRoomState } from './rooms/lifecycle.js';
import { registerCaptureHandlers } from './handlers/capture.js';
import { registerPeerHandlers } from './handlers/peer.js';
import { registerRoomHandlers } from './handlers/room.js';
import {
  transportRoom,
  type HandlerContext,
  type TypedServer,
  type TypedSocket,
} from './handlers/context.js';

export interface SignalingService {
  httpServer: HttpServer;
  io: TypedServer;
  registry: RoomRegistry;
  listen: (port: number) => Promise<number>;
  close: () => Promise<void>;
}

export interface CreateServiceOptions {
  config: AppConfig;
  registryOptions?: RegistryOptions;
  /** Supplied by tests, which would otherwise trip the real join/create limits. */
  rateLimiter?: RateLimiter;
}

export function createSignalingService({
  config,
  registryOptions,
  rateLimiter = new RateLimiter(),
}: CreateServiceOptions): SignalingService {
  const registry = new RoomRegistry(registryOptions);

  function applyCors(request: IncomingMessage, response: ServerResponse): void {
    const origin = request.headers.origin;
    if (origin && config.allowedOrigins.includes(origin)) {
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Vary', 'Origin');
    }
  }

  function sendJson(response: ServerResponse, status: number, body: unknown): void {
    const payload = JSON.stringify(body);
    response.writeHead(status, {
      'content-type': 'application/json',
      'cache-control': 'no-store',
      'content-length': Buffer.byteLength(payload),
    });
    response.end(payload);
  }

  const httpServer = createServer((request, response) => {
    applyCors(request, response);

    if (request.method === 'OPTIONS') {
      response.writeHead(204, {
        'Access-Control-Allow-Methods': 'GET,OPTIONS',
        'Access-Control-Allow-Headers': 'content-type',
      });
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://localhost');

    if (request.method === 'GET' && url.pathname === '/health') {
      sendJson(response, 200, { ok: true, rooms: registry.size });
      return;
    }

    // Short-lived relay credentials are fetched here so they never enter the bundle.
    if (request.method === 'GET' && url.pathname === '/ice-servers') {
      sendJson(response, 200, buildIceConfig(config));
      return;
    }

    sendJson(response, 404, { error: 'Not found' });
  });

  const io: TypedServer = new Server(httpServer, {
    cors: { origin: config.allowedOrigins, methods: ['GET', 'POST'] },
    // Image payloads travel over WebRTC; signaling messages stay small.
    maxHttpBufferSize: 64 * 1024,
    pingTimeout: 20_000,
  });

  const context: HandlerContext = { io, registry, rateLimiter };

  io.on('connection', (socket: TypedSocket) => {
    socket.data.code = null;
    socket.data.role = null;

    registerRoomHandlers(context, socket);
    registerPeerHandlers(context, socket);
    registerCaptureHandlers(context, socket);
  });

  const sweepTimer = setInterval(() => {
    const result = sweep(registry);

    for (const room of result.expiredRooms) {
      io.to(transportRoom(room.code)).emit('capture:abort', {
        sessionId: room.sessionId,
        shotNumber: room.currentShot === 0 ? null : room.currentShot,
        reason: 'room-expired',
      });
      io.to(transportRoom(room.code)).emit('room:state', {
        ...toRoomState(room),
        status: 'expired',
      });
      logger.info('room expired', { code: redactCode(room.code) });
    }

    for (const { room, shotNumber } of result.timedOutShots) {
      io.to(transportRoom(room.code)).emit('capture:abort', {
        sessionId: room.sessionId,
        shotNumber,
        reason: 'transfer-timeout',
      });
      io.to(transportRoom(room.code)).emit('room:state', toRoomState(room));
    }
  }, ROOM_SWEEP_INTERVAL_MS);
  sweepTimer.unref();

  return {
    httpServer,
    io,
    registry,
    listen: (port: number) =>
      new Promise<number>((resolve, reject) => {
        httpServer.once('error', reject);
        httpServer.listen(port, () => {
          const address = httpServer.address();
          resolve(typeof address === 'object' && address ? address.port : port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(sweepTimer);
        io.close(() => httpServer.close(() => resolve()));
      }),
  };
}

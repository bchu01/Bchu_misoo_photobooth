'use client';

/**
 * Room membership for `/pair/[roomCode]`.
 *
 * The room page is only reachable for a room this tab actually joined: it resumes
 * with the opaque token the lobby stored, and a tab without one is told to go
 * back to the lobby rather than silently creating a room.
 *
 * The server's `room:state` is the authoritative view of roles, readiness, and
 * shot progress; nothing here second-guesses it.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { AckStage, Role, RoomError, RoomMembership, RoomState } from '@bchu/shared';
import { newEventId } from '@/lib/async';
import { ensureConnected, getSocket, request, RequestError, type PhotoboothSocket } from '@/lib/socketClient';
import { estimateClockOffset, ZERO_OFFSET, type ClockOffset } from './clockSync';
import { clearPairSession, loadPairSession, savePairSession } from './pairSessionStore';

export type RoomConnection = 'connecting' | 'joined' | 'unauthorized' | 'error';

/** How often the clock offset is re-estimated while the room is open. */
const CLOCK_RESYNC_INTERVAL_MS = 60_000;

export interface PairRoomController {
  socket: PhotoboothSocket;
  connection: RoomConnection;
  role: Role | null;
  roomState: RoomState | null;
  error: RoomError | null;
  clockOffset: ClockOffset;
  isHost: boolean;
  reportReady: (flags: { cameraReady: boolean; dataChannelReady: boolean }) => void;
  startCapture: () => Promise<void>;
  retake: () => Promise<void>;
  acknowledge: (payload: { sessionId: string; shotNumber: number; stage: AckStage }) => void;
  reportShotFailure: (payload: {
    sessionId: string;
    shotNumber: number;
    reason: 'transfer-timeout' | 'camera-lost';
  }) => void;
  leave: () => Promise<void>;
}

/**
 * One resume per code at a time. React Strict Mode runs the effect twice, and
 * the server rotates the reconnect token on every resume, so a second in-flight
 * call would present the token the first call just invalidated.
 */
const resumeInflight = new Map<string, Promise<RoomMembership>>();

function resumeOnce(
  socket: PhotoboothSocket,
  code: string,
  reconnectToken: string,
): Promise<RoomMembership> {
  const existing = resumeInflight.get(code);
  if (existing) return existing;

  const promise = (async () => {
    await ensureConnected(socket);
    const membership = await request(socket, 'room:resume', { code, reconnectToken });
    savePairSession({
      code: membership.code,
      role: membership.role,
      reconnectToken: membership.reconnectToken,
    });
    return membership;
  })().finally(() => {
    if (resumeInflight.get(code) === promise) resumeInflight.delete(code);
  });

  resumeInflight.set(code, promise);
  return promise;
}

export function usePairRoom(code: string): PairRoomController {
  const socket = useMemo(() => getSocket(), []);
  const [connection, setConnection] = useState<RoomConnection>('connecting');
  const [role, setRole] = useState<Role | null>(null);
  const [roomState, setRoomState] = useState<RoomState | null>(null);
  const [error, setError] = useState<RoomError | null>(null);
  const [clockOffset, setClockOffset] = useState<ClockOffset>(ZERO_OFFSET);

  const leftRef = useRef(false);

  useEffect(() => {
    leftRef.current = false;
    let cancelled = false;

    const resume = async () => {
      const stored = loadPairSession(code);
      if (!stored) {
        setConnection('unauthorized');
        return;
      }

      try {
        const membership = await resumeOnce(socket, code, stored.reconnectToken);
        if (cancelled || leftRef.current) return;

        setRole(membership.role);
        setRoomState(membership.state);
        setError(null);
        setConnection('joined');

        const offset = await estimateClockOffset(socket);
        if (!cancelled && !leftRef.current) setClockOffset(offset);
      } catch (cause) {
        if (cancelled || leftRef.current) return;

        const failure =
          cause instanceof RequestError
            ? { code: cause.code === 'TIMEOUT' ? ('INTERNAL' as const) : cause.code, message: cause.message }
            : { code: 'INTERNAL' as const, message: 'Could not rejoin that room.' };

        // An invalid or expired token cannot be recovered from this tab.
        if (failure.code === 'INVALID_TOKEN' || failure.code === 'NOT_FOUND' || failure.code === 'EXPIRED') {
          clearPairSession();
          setConnection('unauthorized');
        } else {
          setConnection('error');
        }
        setError(failure);
      }
    };

    void resume();

    // A dropped transport reconnects into the same role within the grace period.
    const onReconnect = () => void resume();
    socket.on('connect', onReconnect);

    return () => {
      cancelled = true;
      socket.off('connect', onReconnect);
    };
  }, [socket, code]);

  useEffect(() => {
    const onState = (next: RoomState) => {
      if (next.code !== code) return;
      setRoomState(next);
      if (next.status === 'expired') {
        setError({ code: 'EXPIRED', message: 'This room has expired. Create a new one to continue.' });
      }
    };
    const onError = (next: RoomError) => setError(next);

    socket.on('room:state', onState);
    socket.on('room:error', onError);
    return () => {
      socket.off('room:state', onState);
      socket.off('room:error', onError);
    };
  }, [socket, code]);

  useEffect(() => {
    if (connection !== 'joined') return;

    const timer = setInterval(() => {
      void estimateClockOffset(socket, 3)
        .then((offset) => {
          if (!leftRef.current) setClockOffset(offset);
        })
        .catch(() => undefined);
    }, CLOCK_RESYNC_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [socket, connection]);

  const reportReady = useCallback(
    (flags: { cameraReady: boolean; dataChannelReady: boolean }) => {
      if (leftRef.current) return;
      void request(socket, 'peer:ready', flags).catch(() => undefined);
    },
    [socket],
  );

  const startCapture = useCallback(async () => {
    await request(socket, 'capture:start', { eventId: newEventId() });
  }, [socket]);

  const retake = useCallback(async () => {
    await request(socket, 'capture:retake', { eventId: newEventId() });
  }, [socket]);

  const acknowledge = useCallback(
    (payload: { sessionId: string; shotNumber: number; stage: AckStage }) => {
      void request(socket, 'capture:ack', { ...payload, eventId: newEventId() }).catch(() => undefined);
    },
    [socket],
  );

  const reportShotFailure = useCallback(
    (payload: { sessionId: string; shotNumber: number; reason: 'transfer-timeout' | 'camera-lost' }) => {
      void request(socket, 'capture:failed', payload).catch(() => undefined);
    },
    [socket],
  );

  const leave = useCallback(async () => {
    leftRef.current = true;
    clearPairSession();
    try {
      await request(socket, 'room:leave', {});
    } catch {
      // Leaving is best effort; the server expires the room regardless.
    }
  }, [socket]);

  return useMemo(
    () => ({
      socket,
      connection,
      role,
      roomState,
      error,
      clockOffset,
      isHost: role === 'host',
      reportReady,
      startCapture,
      retake,
      acknowledge,
      reportShotFailure,
      leave,
    }),
    [
      socket,
      connection,
      role,
      roomState,
      error,
      clockOffset,
      reportReady,
      startCapture,
      retake,
      acknowledge,
      reportShotFailure,
      leave,
    ],
  );
}

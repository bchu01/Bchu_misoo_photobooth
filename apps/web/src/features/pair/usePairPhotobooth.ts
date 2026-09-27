'use client';

/**
 * Pair capture orchestration.
 *
 * Per shot: the server names a future start time, both clients count down
 * locally, each captures its own frame, sends it over the data channel, and
 * acknowledges the frame it received. A shot is only complete once both halves
 * exist, which is what gates the download.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { COUNTDOWN_SECONDS, SHOTS_PER_SESSION } from '@bchu/shared';
import type { CaptureAbortEvent, CaptureCountdownEvent, Role } from '@bchu/shared';
import { isCancelled, sleep } from '@/lib/async';
import { captureStill, PAIR_CAPTURE_OPTIONS } from '@/features/capture/captureFrame';
import { buildPairSlots, orderPairShot, type PairShotFrames, type StripSlot } from '@/features/strip/stripSlots';
import { serverTimeToLocal } from './clockSync';
import {
  createStillTransport,
  type IncomingStill,
  type StillTransport,
  type StillTransportHandlers,
} from './transferStill';
import type { PairRoomController } from './usePairRoom';

export type ShotPhase = 'idle' | 'countdown' | 'sending' | 'waiting';

export interface PairPhotoboothState {
  /** Host-left ordered slots, one entry per shot; null where a half is missing. */
  slots: Array<StripSlot | null>;
  completeSlots: StripSlot[] | null;
  countdownSeconds: number | null;
  activeShot: number | null;
  phase: ShotPhase;
  transferNote: string | null;
  problem: string | null;
  clearProblem: () => void;
}

interface Options {
  room: PairRoomController;
  channel: RTCDataChannel | null;
  channelOpen: boolean;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  mirrored: boolean;
}

const EMPTY_SHOTS: ReadonlyMap<number, PairShotFrames> = new Map();

/**
 * Frames are stamped with the session they belong to. A retake issues a new
 * session id, which makes every held frame stale by construction — no clearing
 * step, and no window in which a late frame from the old sequence can be shown.
 */
interface FrameStore {
  sessionId: string | null;
  shots: ReadonlyMap<number, PairShotFrames>;
}

const EMPTY_STORE: FrameStore = { sessionId: null, shots: EMPTY_SHOTS };

export function usePairPhotobooth({
  room,
  channel,
  channelOpen,
  videoRef,
  mirrored,
}: Options): PairPhotoboothState {
  /**
   * The room controller is a new object on every `room:state` broadcast, so only
   * its stable callbacks are used as dependencies here. Depending on the whole
   * controller would tear the data channel transport down mid-transfer.
   */
  const { socket, acknowledge, reportShotFailure } = room;

  const [store, setStore] = useState<FrameStore>(EMPTY_STORE);
  const [countdownSeconds, setCountdownSeconds] = useState<number | null>(null);
  const [activeShot, setActiveShot] = useState<number | null>(null);
  const [phase, setPhase] = useState<ShotPhase>('idle');
  const [problem, setProblem] = useState<string | null>(null);

  const transportRef = useRef<StillTransport | null>(null);
  const shotAbortRef = useRef<AbortController | null>(null);

  const sessionId = room.roomState?.sessionId ?? null;
  const shots = store.sessionId === sessionId ? store.shots : EMPTY_SHOTS;

  // Values the async shot routine needs at capture time, not at scheduling time.
  const roleRef = useRef<Role | null>(room.role);
  const mirroredRef = useRef(mirrored);
  const offsetRef = useRef(room.clockOffset);
  useEffect(() => {
    roleRef.current = room.role;
    mirroredRef.current = mirrored;
    offsetRef.current = room.clockOffset;
  }, [room.role, mirrored, room.clockOffset]);

  const storeFrame = useCallback((frameSessionId: string, shotNumber: number, role: Role, blob: Blob) => {
    setStore((current) => {
      // A frame for a different session replaces the store rather than merging.
      const shots = current.sessionId === frameSessionId ? current.shots : EMPTY_SHOTS;
      const next = new Map(shots);
      next.set(shotNumber, { ...next.get(shotNumber), [role]: blob });
      return { sessionId: frameSessionId, shots: next };
    });
  }, []);

  /* ----------------------------- data channel ----------------------------- */

  const onStill = useCallback(
    (still: IncomingStill) => {
      storeFrame(still.sessionId, still.shotNumber, still.role, still.blob);
      acknowledge({
        sessionId: still.sessionId,
        shotNumber: still.shotNumber,
        stage: 'peer-received',
      });
    },
    [acknowledge, storeFrame],
  );

  const onFailure = useCallback((message: string) => setProblem(message), []);

  // Indirection through a ref keeps the transport alive across re-renders.
  const handlersRef = useRef<StillTransportHandlers>({ onStill, onFailure });
  useEffect(() => {
    handlersRef.current = { onStill, onFailure };
  }, [onStill, onFailure]);

  useEffect(() => {
    if (!channel || !channelOpen) {
      transportRef.current = null;
      return;
    }

    const transport = createStillTransport(channel, {
      onStill: (still) => handlersRef.current.onStill(still),
      onFailure: (message) => handlersRef.current.onFailure(message),
    });
    transportRef.current = transport;

    return () => {
      transportRef.current = null;
      transport.dispose();
    };
  }, [channel, channelOpen]);

  /* ------------------------------ shot runner ----------------------------- */

  const runShot = useCallback(
    async (event: CaptureCountdownEvent, signal: AbortSignal) => {
      const role = roleRef.current;
      if (!role) return;

      setActiveShot(event.shotNumber);
      setPhase('countdown');

      // Count down against the shared start time rather than a local stopwatch.
      const targetAt = serverTimeToLocal(event.startAt, offsetRef.current);
      let shown: number | null = null;
      for (;;) {
        const remaining = targetAt - Date.now();
        if (remaining <= 0) break;

        const seconds = Math.min(COUNTDOWN_SECONDS, Math.ceil(remaining / 1000));
        if (seconds !== shown) {
          shown = seconds;
          setCountdownSeconds(seconds);
        }
        await sleep(Math.min(100, remaining), signal);
      }
      setCountdownSeconds(0);

      const video = videoRef.current;
      if (!video) throw new Error('The camera preview is not ready.');

      const blob = await captureStill(video, { ...PAIR_CAPTURE_OPTIONS, mirrored: mirroredRef.current });
      if (signal.aborted) return;

      storeFrame(event.sessionId, event.shotNumber, role, blob);
      acknowledge({ sessionId: event.sessionId, shotNumber: event.shotNumber, stage: 'local' });
      setCountdownSeconds(null);

      // Read the transport at the point of use so it is always the live one.
      const transport = transportRef.current;
      if (!transport) throw new Error('The photo connection to your friend is not open.');

      setPhase('sending');
      await transport.send({ sessionId: event.sessionId, shotNumber: event.shotNumber, role }, blob);
      if (signal.aborted) return;

      // The shot is not finished until the peer's half arrives too.
      setPhase('waiting');
    },
    [acknowledge, storeFrame, videoRef],
  );

  useEffect(() => {
    const onCountdown = (event: CaptureCountdownEvent) => {
      shotAbortRef.current?.abort();
      const controller = new AbortController();
      shotAbortRef.current = controller;

      void runShot(event, controller.signal).catch((cause) => {
        if (isCancelled(cause)) return;

        setCountdownSeconds(null);
        setPhase('idle');
        setProblem(cause instanceof Error ? cause.message : 'That shot could not be completed.');
        reportShotFailure({
          sessionId: event.sessionId,
          shotNumber: event.shotNumber,
          reason: 'transfer-timeout',
        });
      });
    };

    const onAbort = (event: CaptureAbortEvent) => {
      shotAbortRef.current?.abort();
      shotAbortRef.current = null;
      setCountdownSeconds(null);
      setActiveShot(null);
      setPhase('idle');

      if (event.reason === 'host-retake') {
        // The server has already issued a new session id, which retires the frames.
        setStore(EMPTY_STORE);
        transportRef.current?.reset(event.sessionId);
        setProblem(null);
        return;
      }

      // Completed shots survive; only the interrupted one is discarded.
      if (event.shotNumber !== null) {
        const discarded = event.shotNumber;
        setStore((current) => {
          if (!current.shots.has(discarded)) return current;
          const next = new Map(current.shots);
          next.delete(discarded);
          return { sessionId: current.sessionId, shots: next };
        });
      }

      setProblem(ABORT_MESSAGES[event.reason]);
    };

    const onNext = () => {
      setPhase('idle');
      setCountdownSeconds(null);
    };

    socket.on('capture:countdown', onCountdown);
    socket.on('capture:abort', onAbort);
    socket.on('capture:next', onNext);

    return () => {
      socket.off('capture:countdown', onCountdown);
      socket.off('capture:abort', onAbort);
      socket.off('capture:next', onNext);
    };
  }, [socket, runShot, reportShotFailure]);

  // A new session id also cancels anything still running for the old one.
  useEffect(() => {
    shotAbortRef.current?.abort();
    shotAbortRef.current = null;
  }, [sessionId]);

  useEffect(() => () => shotAbortRef.current?.abort(), []);

  /* -------------------------------- derived ------------------------------- */

  const slots = useMemo<Array<StripSlot | null>>(
    () =>
      Array.from({ length: SHOTS_PER_SESSION }, (_unused, index) =>
        orderPairShot(shots.get(index + 1)),
      ),
    [shots],
  );

  const completeSlots = useMemo(() => buildPairSlots(shots, SHOTS_PER_SESSION), [shots]);

  const transferNote =
    phase === 'sending'
      ? 'Sending your photo to your friend…'
      : phase === 'waiting'
        ? "Waiting for your friend's photo…"
        : null;

  const clearProblem = useCallback(() => setProblem(null), []);

  return {
    slots,
    completeSlots,
    countdownSeconds,
    activeShot,
    phase,
    transferNote,
    problem,
    clearProblem,
  };
}

const ABORT_MESSAGES: Record<CaptureAbortEvent['reason'], string> = {
  'peer-left': 'Your friend disconnected, so that shot was cancelled.',
  'transfer-timeout': 'A photo did not arrive in time, so that shot was cancelled.',
  'host-retake': 'The host started over.',
  'room-expired': 'The room expired.',
  'camera-lost': 'A camera stopped working, so that shot was cancelled.',
};

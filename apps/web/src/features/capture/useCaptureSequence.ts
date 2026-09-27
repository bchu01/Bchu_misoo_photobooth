'use client';

/**
 * Drives the Solo capture sequence: a visible countdown before each of the four
 * frames, with no frame ever silently skipped. Pair sequences are scheduled by
 * the server instead — see `features/pair/usePairPhotobooth`.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { COUNTDOWN_SECONDS, SHOTS_PER_SESSION } from '@bchu/shared';
import { isCancelled, sleep } from '@/lib/async';

export type SequenceState = 'idle' | 'running' | 'complete' | 'error';

export interface CaptureSequence {
  state: SequenceState;
  /** 0 when idle, otherwise the shot currently being taken. */
  currentShot: number;
  /** Countdown value to display, or null when no countdown is showing. */
  secondsRemaining: number | null;
  frames: ReadonlyArray<Blob | null>;
  error: string | null;
  start: () => void;
  reset: () => void;
}

const emptyFrames = (): Array<Blob | null> => Array.from({ length: SHOTS_PER_SESSION }, () => null);

export function useCaptureSequence(
  captureShot: (shotNumber: number) => Promise<Blob>,
): CaptureSequence {
  const [state, setState] = useState<SequenceState>('idle');
  const [currentShot, setCurrentShot] = useState(0);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);
  const [frames, setFrames] = useState<Array<Blob | null>>(emptyFrames);
  const [error, setError] = useState<string | null>(null);

  const abortRef = useRef<AbortController | null>(null);

  // Keeps the running sequence on the newest capture callback without restarting it.
  const captureRef = useRef(captureShot);
  useEffect(() => {
    captureRef.current = captureShot;
  }, [captureShot]);

  const cancel = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
  }, []);

  useEffect(() => cancel, [cancel]);

  const reset = useCallback(() => {
    cancel();
    setFrames(emptyFrames());
    setCurrentShot(0);
    setSecondsRemaining(null);
    setError(null);
    setState('idle');
  }, [cancel]);

  const start = useCallback(() => {
    cancel();
    const controller = new AbortController();
    abortRef.current = controller;
    const { signal } = controller;

    setFrames(emptyFrames());
    setError(null);
    setState('running');

    void (async () => {
      try {
        for (let shot = 1; shot <= SHOTS_PER_SESSION; shot += 1) {
          setCurrentShot(shot);

          for (let second = COUNTDOWN_SECONDS; second > 0; second -= 1) {
            setSecondsRemaining(second);
            await sleep(1000, signal);
          }
          setSecondsRemaining(0);

          const blob = await captureRef.current(shot);
          if (signal.aborted) return;

          setFrames((current) => current.map((frame, index) => (index === shot - 1 ? blob : frame)));
          setSecondsRemaining(null);
          // A short beat so the filled slot is visible before the next countdown.
          await sleep(600, signal);
        }

        setCurrentShot(0);
        setState('complete');
      } catch (cause) {
        if (isCancelled(cause)) return;
        setSecondsRemaining(null);
        setCurrentShot(0);
        setState('error');
        setError(cause instanceof Error ? cause.message : 'The photo sequence stopped unexpectedly.');
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    })();
  }, [cancel]);

  return { state, currentShot, secondsRemaining, frames, error, start, reset };
}

'use client';

/**
 * Client/server clock offset estimation.
 *
 * The server schedules each capture at a future timestamp on its own clock; each
 * client converts that to local time using this offset. Several round trips are
 * taken and the one with the lowest latency wins, since that sample has the least
 * asymmetry. This aligns countdowns — it is not frame-level synchronization, and
 * nothing in the app depends on it being exact.
 */

import { CLOCK_SYNC_SAMPLES } from '@bchu/shared';
import { request, type PhotoboothSocket } from '@/lib/socketClient';

export interface ClockOffset {
  /** serverNow − localNow, in milliseconds. */
  offsetMs: number;
  /** Round-trip time of the sample this offset came from. */
  rttMs: number;
}

export const ZERO_OFFSET: ClockOffset = { offsetMs: 0, rttMs: 0 };

export async function estimateClockOffset(
  socket: PhotoboothSocket,
  samples = CLOCK_SYNC_SAMPLES,
): Promise<ClockOffset> {
  let best: ClockOffset | null = null;

  for (let index = 0; index < samples; index += 1) {
    const sentAt = Date.now();
    const { serverTime } = await request(socket, 'time:sync', { clientTime: sentAt });
    const receivedAt = Date.now();

    const rttMs = receivedAt - sentAt;
    const offsetMs = serverTime - (sentAt + rttMs / 2);

    if (!best || rttMs < best.rttMs) best = { offsetMs, rttMs };
  }

  return best ?? ZERO_OFFSET;
}

/** Converts a server timestamp into this device's clock. */
export function serverTimeToLocal(serverTime: number, offset: ClockOffset): number {
  return serverTime - offset.offsetMs;
}

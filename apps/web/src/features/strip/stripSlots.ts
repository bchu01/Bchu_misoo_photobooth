/**
 * Turns captured stills into ordered strip slots.
 *
 * The export order is fixed: a Pair frame is always host-left, guest-right for
 * both participants, regardless of who is downloading. The on-screen preview may
 * label the local person first, but this module decides what gets drawn.
 */

import type { Role } from '@bchu/shared';

/** One or two images drawn left to right inside a single frame slot. */
export type StripSlot = readonly Blob[];

/** The two halves of one Pair frame, keyed by the role that captured them. */
export type PairShotFrames = Partial<Record<Role, Blob>>;

export const PAIR_EXPORT_ORDER: readonly Role[] = ['host', 'guest'];

export function isPairShotComplete(frames: PairShotFrames | undefined): boolean {
  return Boolean(frames?.host && frames.guest);
}

/** Returns the frame's images in export order, or null if a half is missing. */
export function orderPairShot(frames: PairShotFrames | undefined): StripSlot | null {
  if (!frames) return null;
  const ordered = PAIR_EXPORT_ORDER.map((role) => frames[role]);
  if (ordered.some((blob) => !blob)) return null;
  return ordered as Blob[];
}

/**
 * Builds Solo slots. Returns null unless every shot has been captured, which is
 * what gates the download control.
 */
export function buildSoloSlots(
  frames: ReadonlyArray<Blob | null | undefined>,
  shotCount: number,
): StripSlot[] | null {
  const slots: StripSlot[] = [];
  for (let index = 0; index < shotCount; index += 1) {
    const frame = frames[index];
    if (!frame) return null;
    slots.push([frame]);
  }
  return slots;
}

/**
 * Builds Pair slots from a shot-number keyed store. Returns null when any of the
 * eight underlying stills is missing, so an incomplete strip can never be saved.
 */
export function buildPairSlots(
  shots: ReadonlyMap<number, PairShotFrames>,
  shotCount: number,
): StripSlot[] | null {
  const slots: StripSlot[] = [];
  for (let shotNumber = 1; shotNumber <= shotCount; shotNumber += 1) {
    const ordered = orderPairShot(shots.get(shotNumber));
    if (!ordered) return null;
    slots.push(ordered);
  }
  return slots;
}

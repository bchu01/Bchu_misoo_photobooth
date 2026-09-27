/**
 * The single source of truth for photo strip geometry.
 *
 * Everything visual about the exported PNG is described here so the later Figma
 * pass can be applied by editing this one file. No other module hard-codes a
 * pixel value or colour used in the strip.
 */

export const STRIP_LAYOUT = {
  /** Required export width. Height is derived from the slot count. */
  widthPx: 600,
  outerPaddingPx: 24,
  /** Vertical space between frame slots. */
  slotGapPx: 16,
  /** Gutter between the two halves of a Pair frame. */
  innerGapPx: 8,
  /** Frame slot width divided by height. Portrait for both Solo and Pair. */
  slotAspectRatio: 3 / 4,
  backgroundColor: '#f4f4f5',
  /** Shown behind an empty or still-loading slot. */
  slotBackgroundColor: '#d4d4d8',
} as const;

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface StripLayout {
  width: number;
  height: number;
  slots: Rect[];
}

export interface Size {
  width: number;
  height: number;
}

/**
 * Vertical stack of equally sized portrait slots with consistent margins.
 * All values are whole pixels so canvas drawing never lands on half pixels.
 */
export function computeStripLayout(slotCount: number): StripLayout {
  if (!Number.isInteger(slotCount) || slotCount < 1) {
    throw new Error(`Strip needs at least one slot, received ${slotCount}.`);
  }

  const { widthPx, outerPaddingPx, slotGapPx, slotAspectRatio } = STRIP_LAYOUT;
  const slotWidth = widthPx - outerPaddingPx * 2;
  const slotHeight = Math.round(slotWidth / slotAspectRatio);

  const slots: Rect[] = [];
  for (let index = 0; index < slotCount; index += 1) {
    slots.push({
      x: outerPaddingPx,
      y: outerPaddingPx + index * (slotHeight + slotGapPx),
      width: slotWidth,
      height: slotHeight,
    });
  }

  const height = outerPaddingPx * 2 + slotCount * slotHeight + (slotCount - 1) * slotGapPx;
  return { width: widthPx, height, slots };
}

/**
 * Splits one slot into side-by-side regions. A Solo frame fills the slot; a
 * Pair frame is two regions in host-left order.
 */
export function computeSlotRegions(slot: Rect, imageCount: number): Rect[] {
  if (imageCount === 1) return [slot];
  if (imageCount !== 2) {
    throw new Error(`A frame slot holds one or two images, received ${imageCount}.`);
  }

  const { innerGapPx } = STRIP_LAYOUT;
  const regionWidth = Math.floor((slot.width - innerGapPx) / 2);
  return [
    { x: slot.x, y: slot.y, width: regionWidth, height: slot.height },
    {
      x: slot.x + slot.width - regionWidth,
      y: slot.y,
      width: regionWidth,
      height: slot.height,
    },
  ];
}

/**
 * Source rectangle that fills `target` without distortion, cropped from the
 * centre of `source`. Passed straight to canvas `drawImage`.
 */
export function computeCoverCrop(source: Size, target: Size): Rect {
  if (source.width <= 0 || source.height <= 0) {
    throw new Error('Cannot crop an image with a zero dimension.');
  }

  const scale = Math.max(target.width / source.width, target.height / source.height);
  const cropWidth = Math.min(source.width, target.width / scale);
  const cropHeight = Math.min(source.height, target.height / scale);

  return {
    x: (source.width - cropWidth) / 2,
    y: (source.height - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
  };
}

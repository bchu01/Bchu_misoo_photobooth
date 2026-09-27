/**
 * The one shared strip renderer used by Solo and Pair.
 *
 * Both participants in a Pair session run this same function over the same
 * ordered stills, which is what makes their downloads identical.
 */

import { computeCoverCrop, computeSlotRegions, computeStripLayout, STRIP_LAYOUT } from './stripLayout';
import type { StripSlot } from './stripSlots';

type DecodedImage = ImageBitmap | HTMLImageElement;

function imageSize(image: DecodedImage): { width: number; height: number } {
  return image instanceof HTMLImageElement
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : { width: image.width, height: image.height };
}

/** `createImageBitmap` everywhere it exists, with an object-URL fallback. */
async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (typeof createImageBitmap === 'function') {
    return createImageBitmap(blob);
  }

  const url = URL.createObjectURL(blob);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('Could not decode a captured frame.'));
      image.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

function release(image: DecodedImage): void {
  if (!(image instanceof HTMLImageElement)) image.close();
}

function canvasToPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('Could not encode the photo strip.'));
    }, 'image/png');
  });
}

/**
 * Draws every slot into one PNG. `slots` must already be in export order:
 * one image per slot for Solo, two host-left images per slot for Pair.
 */
export async function renderStripPng(slots: readonly StripSlot[]): Promise<Blob> {
  const layout = computeStripLayout(slots.length);

  const canvas = document.createElement('canvas');
  canvas.width = layout.width;
  canvas.height = layout.height;

  const context = canvas.getContext('2d');
  if (!context) throw new Error('This browser cannot render the photo strip.');

  context.fillStyle = STRIP_LAYOUT.backgroundColor;
  context.fillRect(0, 0, layout.width, layout.height);

  for (const [index, images] of slots.entries()) {
    const slot = layout.slots[index];
    if (!slot) continue;

    context.fillStyle = STRIP_LAYOUT.slotBackgroundColor;
    context.fillRect(slot.x, slot.y, slot.width, slot.height);

    const regions = computeSlotRegions(slot, images.length);
    for (const [regionIndex, blob] of images.entries()) {
      const region = regions[regionIndex];
      if (!region) continue;

      const image = await decodeImage(blob);
      try {
        const crop = computeCoverCrop(imageSize(image), region);
        context.drawImage(
          image,
          crop.x,
          crop.y,
          crop.width,
          crop.height,
          region.x,
          region.y,
          region.width,
          region.height,
        );
      } finally {
        release(image);
      }
    }
  }

  return canvasToPngBlob(canvas);
}

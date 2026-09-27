/**
 * Grabs a single still from a live video element.
 *
 * Mirroring is baked in here so a saved frame always matches what the person saw
 * in their own preview. The remote person's frame arrives already oriented and is
 * never re-mirrored on the receiving side.
 */

import { MAX_STILL_BYTES } from '@bchu/shared';

export interface CaptureStillOptions {
  /** Applies the same horizontal flip the local preview uses. */
  mirrored: boolean;
  /** Caps the stored frame so a Pair transfer stays within its byte budget. */
  maxWidth: number;
  quality: number;
}

export const SOLO_CAPTURE_OPTIONS: Omit<CaptureStillOptions, 'mirrored'> = {
  maxWidth: 1440,
  quality: 0.92,
};

/** Smaller and more compressed, because every Pair frame crosses the network. */
export const PAIR_CAPTURE_OPTIONS: Omit<CaptureStillOptions, 'mirrored'> = {
  maxWidth: 1024,
  quality: 0.82,
};

export class CaptureError extends Error {}

function canvasToJpegBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new CaptureError('Could not save that frame.'));
      },
      'image/jpeg',
      quality,
    );
  });
}

export async function captureStill(
  video: HTMLVideoElement,
  options: CaptureStillOptions,
): Promise<Blob> {
  const sourceWidth = video.videoWidth;
  const sourceHeight = video.videoHeight;
  if (sourceWidth === 0 || sourceHeight === 0) {
    throw new CaptureError('The camera is not sending frames yet.');
  }

  const scale = Math.min(1, options.maxWidth / sourceWidth);
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(sourceWidth * scale);
  canvas.height = Math.round(sourceHeight * scale);

  const context = canvas.getContext('2d');
  if (!context) throw new CaptureError('This browser cannot capture photos.');

  if (options.mirrored) {
    context.translate(canvas.width, 0);
    context.scale(-1, 1);
  }
  context.drawImage(video, 0, 0, canvas.width, canvas.height);

  let blob = await canvasToJpegBlob(canvas, options.quality);

  // One retry at lower quality keeps an unusually detailed frame transferable.
  if (blob.size > MAX_STILL_BYTES) {
    blob = await canvasToJpegBlob(canvas, Math.max(0.5, options.quality - 0.25));
  }
  if (blob.size > MAX_STILL_BYTES) {
    throw new CaptureError('That frame was too large to share. Try a lower camera resolution.');
  }

  return blob;
}

'use client';

import { SHOTS_PER_SESSION } from '@bchu/shared';
import type { StripSlot } from '@/features/strip/stripSlots';
import { BlobImage } from './BlobImage';

/**
 * On-screen version of the exported strip: the same number of slots, filled in
 * the same left-to-right order, so the preview matches the downloaded PNG.
 *
 * Empty slots are shown from the start and labelled, so a person always knows how
 * many frames are still to come.
 */
export interface PhotoStripPreviewProps {
  /** One entry per shot. A null entry renders as an empty slot. */
  slots: ReadonlyArray<StripSlot | null>;
  /** Highlights the shot currently being taken. */
  activeShot?: number | null;
}

export function PhotoStripPreview({ slots, activeShot = null }: PhotoStripPreviewProps) {
  const filledCount = slots.filter(Boolean).length;
  const totalSlots = slots.length || SHOTS_PER_SESSION;

  return (
    <section aria-labelledby="strip-heading" className="flex flex-col gap-3">
      <h2 id="strip-heading" className="text-lg font-semibold">
        Photo strip
      </h2>
      <p className="text-sm text-zinc-700" aria-live="polite">
        {filledCount} of {totalSlots} frames captured.
      </p>

      <ol className="mx-auto flex w-full max-w-56 flex-col gap-2 rounded-md border border-zinc-300 bg-zinc-100 p-2">
        {slots.map((slot, index) => {
          const shotNumber = index + 1;
          return (
            <li
              key={shotNumber}
              className={`flex aspect-3/4 gap-1 overflow-hidden rounded bg-zinc-300 ${
                activeShot === shotNumber ? 'ring-2 ring-zinc-900' : ''
              }`}
            >
              {slot ? (
                slot.map((blob, partIndex) => (
                  <BlobImage
                    key={partIndex}
                    blob={blob}
                    alt={
                      slot.length > 1
                        ? `Frame ${shotNumber}, part ${partIndex + 1} of ${slot.length}`
                        : `Frame ${shotNumber}`
                    }
                    className="h-full min-w-0 flex-1 object-cover"
                  />
                ))
              ) : (
                <span className="flex h-full w-full items-center justify-center text-xs text-zinc-600">
                  Frame {shotNumber}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

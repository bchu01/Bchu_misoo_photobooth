'use client';

import { useEffect, useRef } from 'react';
import { Countdown } from './Countdown';

/**
 * A live camera feed. Labelled "Live" at all times so it can never be mistaken
 * for a captured still.
 *
 * `mirrored` is applied to the local preview only. A remote feed arrives already
 * oriented the way its owner saw it and is never flipped again here.
 */
export interface CameraPreviewProps {
  label: string;
  stream: MediaStream | null;
  mirrored?: boolean;
  /** Lets the parent grab frames from this exact element. */
  videoRef?: React.RefObject<HTMLVideoElement | null>;
  /** Shown in place of the video when there is no stream. */
  placeholder?: React.ReactNode;
  countdownSeconds?: number | null;
  badge?: string;
}

export function CameraPreview({
  label,
  stream,
  mirrored = false,
  videoRef,
  placeholder,
  countdownSeconds = null,
  badge,
}: CameraPreviewProps) {
  const internalRef = useRef<HTMLVideoElement | null>(null);
  // The parent's ref wins when supplied, so it can capture frames from this element.
  const elementRef = videoRef ?? internalRef;

  useEffect(() => {
    const video = elementRef.current;
    if (!video) return;

    if (video.srcObject !== stream) video.srcObject = stream;
    if (!stream) return;

    // Autoplay is allowed because the element is muted and carries no audio.
    const play = video.play();
    if (play) play.catch(() => undefined);
  }, [stream, elementRef]);

  return (
    <figure className="flex min-w-0 flex-col gap-2">
      <div className="relative aspect-3/4 w-full overflow-hidden rounded-md border border-zinc-300 bg-zinc-800">
        {stream ? (
          <video
            ref={elementRef}
            className={`h-full w-full object-cover ${mirrored ? '-scale-x-100' : ''}`}
            playsInline
            autoPlay
            muted
            aria-label={`${label}, live camera`}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center p-4 text-center text-sm text-zinc-200">
            {placeholder ?? 'No camera yet.'}
          </div>
        )}

        {countdownSeconds !== null ? <Countdown seconds={countdownSeconds} /> : null}

        {stream ? (
          <span className="absolute top-2 left-2 rounded bg-black/70 px-2 py-1 text-xs font-medium text-white">
            Live
          </span>
        ) : null}
      </div>

      <figcaption className="flex items-center justify-between gap-2 text-sm text-zinc-700">
        <span className="font-medium">{label}</span>
        {badge ? <span className="text-xs text-zinc-600">{badge}</span> : null}
      </figcaption>
    </figure>
  );
}

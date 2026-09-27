'use client';

/**
 * Solo photobooth. A thin composition layer: the camera, the capture sequence,
 * and the strip renderer each own their own logic.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { SHOTS_PER_SESSION } from '@bchu/shared';
import { CameraPreview } from '@/components/CameraPreview';
import { CameraSettings } from '@/components/CameraSettings';
import { PhotoStripPreview } from '@/components/PhotoStripPreview';
import { StatusMessage } from '@/components/StatusMessage';
import { Button } from '@/components/ui/Button';
import { useCamera } from '@/features/camera/useCamera';
import { captureStill, SOLO_CAPTURE_OPTIONS } from '@/features/capture/captureFrame';
import { useCaptureSequence } from '@/features/capture/useCaptureSequence';
import { downloadBlob, stripFileName } from '@/features/strip/downloadStrip';
import { renderStripPng } from '@/features/strip/renderStrip';
import { buildSoloSlots, type StripSlot } from '@/features/strip/stripSlots';

export function SoloPhotobooth() {
  const camera = useCamera(true);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [downloadError, setDownloadError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // Read through a ref so the sequence never captures a stale mirror setting.
  const mirroredRef = useRef(camera.mirrored);
  useEffect(() => {
    mirroredRef.current = camera.mirrored;
  }, [camera.mirrored]);

  const captureShot = useCallback(async () => {
    const video = videoRef.current;
    if (!video) throw new Error('The camera preview is not ready yet.');
    return captureStill(video, { ...SOLO_CAPTURE_OPTIONS, mirrored: mirroredRef.current });
  }, []);

  const sequence = useCaptureSequence(captureShot);

  const slots = useMemo<Array<StripSlot | null>>(
    () => sequence.frames.map((frame) => (frame ? [frame] : null)),
    [sequence.frames],
  );

  const completeSlots = useMemo(
    () => buildSoloSlots(sequence.frames, SHOTS_PER_SESSION),
    [sequence.frames],
  );

  const canStart = camera.status === 'ready' && sequence.state !== 'running';

  const handleDownload = useCallback(async () => {
    if (!completeSlots) return;
    setIsSaving(true);
    setDownloadError(null);
    try {
      const png = await renderStripPng(completeSlots);
      downloadBlob(png, stripFileName('solo'));
    } catch (error) {
      setDownloadError(error instanceof Error ? error.message : 'Could not save the photo strip.');
    } finally {
      setIsSaving(false);
    }
  }, [completeSlots]);

  return (
    <div className="flex flex-col gap-6">
      {camera.failure ? (
        <StatusMessage
          tone="error"
          action={
            camera.failure.retryable ? (
              <Button variant="secondary" onClick={camera.retry}>
                Try again
              </Button>
            ) : null
          }
        >
          {camera.failure.message}
        </StatusMessage>
      ) : null}

      {sequence.error ? <StatusMessage tone="error">{sequence.error}</StatusMessage> : null}
      {downloadError ? <StatusMessage tone="error">{downloadError}</StatusMessage> : null}

      {/* Reading order on narrow screens: settings, camera, strip, actions. */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(12rem,16rem)]">
        <CameraSettings camera={camera} />

        <div className="flex min-w-0 flex-col gap-4">
          <CameraPreview
            label="You"
            stream={camera.stream}
            mirrored={camera.mirrored}
            videoRef={videoRef}
            countdownSeconds={sequence.secondsRemaining}
            badge={sequence.state === 'running' ? `Shot ${sequence.currentShot} of ${SHOTS_PER_SESSION}` : undefined}
            placeholder={
              camera.status === 'requesting' ? 'Waiting for camera permission…' : 'Camera is off.'
            }
          />
        </div>

        <PhotoStripPreview slots={slots} activeShot={sequence.currentShot || null} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-300 pt-4">
        <div className="flex flex-wrap gap-3">
          <Button variant="primary" onClick={sequence.start} disabled={!canStart}>
            {sequence.state === 'complete' || sequence.state === 'error' ? 'Retake' : 'Take photos'}
          </Button>
          {sequence.state === 'running' ? (
            <Button variant="secondary" onClick={sequence.reset}>
              Stop
            </Button>
          ) : null}
        </div>

        <Button
          variant="primary"
          onClick={() => void handleDownload()}
          disabled={!completeSlots || isSaving}
        >
          {isSaving ? 'Preparing PNG…' : 'Download PNG'}
        </Button>
      </div>
    </div>
  );
}

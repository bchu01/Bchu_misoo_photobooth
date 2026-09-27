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
import { BoothShelf } from '@/components/brand/BoothShelf';
import { BoothWindow } from '@/components/brand/BoothWindow';
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

  const shutterLabel =
    sequence.state === 'running'
      ? 'Stop'
      : sequence.state === 'complete' || sequence.state === 'error'
        ? 'Retake'
        : 'Take photos';

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col items-center gap-6 px-3 py-8">
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

      <BoothWindow
        footer={
          <BoothShelf
            mode="solo"
            shutterLabel={shutterLabel}
            shutterDisabled={!canStart && sequence.state !== 'running'}
            onShutter={sequence.state === 'running' ? sequence.reset : sequence.start}
            downloadLabel={isSaving ? 'Preparing…' : 'Download'}
            downloadDisabled={!completeSlots || isSaving}
            onDownload={() => void handleDownload()}
            note={sequence.state === 'running' ? 'Taking photos. Press the shutter to stop.' : undefined}
          />
        }
      >
        <div className="h-[42vh] min-h-64 max-h-[507px]">
          <CameraPreview
            bare
            label="You"
            stream={camera.stream}
            mirrored={camera.mirrored}
            videoRef={videoRef}
            countdownSeconds={sequence.secondsRemaining}
            badge={
              sequence.state === 'running' ? `Shot ${sequence.currentShot} of ${SHOTS_PER_SESSION}` : undefined
            }
            placeholder={
              camera.status === 'requesting' ? 'Waiting for camera permission…' : 'Camera is off.'
            }
          />
        </div>
      </BoothWindow>

      <PhotoStripPreview slots={slots} activeShot={sequence.currentShot || null} />

      <details className="w-[min(988px,calc(100%-1.5rem))] rounded-[28px] border border-black bg-[rgba(243,243,243,0.74)] p-4">
        <summary className="cursor-pointer text-lg tracking-[-0.05em]">Camera</summary>
        <div className="pt-4">
          <CameraSettings camera={camera} />
        </div>
      </details>
    </main>
  );
}

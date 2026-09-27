'use client';

/**
 * Owns the local camera: permission, device selection, mirroring, teardown.
 *
 * Requests video only — the photobooth has no need for microphone access. Tracks
 * are stopped whenever the hook is disabled or unmounted, so leaving a room
 * always turns the camera light off.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { classifyCameraError, describeCameraFailure, type CameraFailure } from './cameraErrors';

export type CameraStatus = 'idle' | 'requesting' | 'ready' | 'error';

export interface CameraDevice {
  deviceId: string;
  label: string;
}

export interface CameraController {
  status: CameraStatus;
  stream: MediaStream | null;
  failure: CameraFailure | null;
  devices: CameraDevice[];
  /** The camera actually in use, which may differ from what was requested. */
  activeDeviceId: string | null;
  mirrored: boolean;
  selectDevice: (deviceId: string) => void;
  setMirrored: (mirrored: boolean) => void;
  retry: () => void;
}

function supportsCamera(): boolean {
  return typeof navigator !== 'undefined' && Boolean(navigator.mediaDevices?.getUserMedia);
}

function stopStream(stream: MediaStream | null): void {
  stream?.getTracks().forEach((track) => track.stop());
}

export function useCamera(enabled: boolean): CameraController {
  const [status, setStatus] = useState<CameraStatus>('idle');
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [failure, setFailure] = useState<CameraFailure | null>(null);
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  /**
   * The explicit user choice. Kept separate from the active device so that
   * learning which camera the browser picked does not restart the stream.
   */
  const [requestedDeviceId, setRequestedDeviceId] = useState<string | null>(null);
  const [activeDeviceId, setActiveDeviceId] = useState<string | null>(null);
  // Front-facing cameras read as a mirror, which is what people expect to see.
  const [mirrored, setMirrored] = useState(true);
  const [attempt, setAttempt] = useState(0);

  const streamRef = useRef<MediaStream | null>(null);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const all = await navigator.mediaDevices.enumerateDevices();
    setDevices(
      all
        .filter((device) => device.kind === 'videoinput')
        .map((device, index) => ({
          deviceId: device.deviceId,
          // Labels are only populated once permission has been granted.
          label: device.label || `Camera ${index + 1}`,
        })),
    );
  }, []);

  useEffect(() => {
    if (!enabled) return;

    // Guards against a stale request winning after a device switch or remount.
    let cancelled = false;

    void (async () => {
      if (!supportsCamera()) {
        setStatus('error');
        setFailure(describeCameraFailure('unsupported'));
        return;
      }
      if (!window.isSecureContext) {
        setStatus('error');
        setFailure(describeCameraFailure('insecure-context'));
        return;
      }

      setStatus('requesting');
      setFailure(null);

      const constraints: MediaStreamConstraints = {
        audio: false,
        video: requestedDeviceId
          ? { deviceId: { exact: requestedDeviceId } }
          : { facingMode: 'user', width: { ideal: 1280 }, height: { ideal: 720 } },
      };

      try {
        const acquired = await navigator.mediaDevices.getUserMedia(constraints);
        if (cancelled) {
          stopStream(acquired);
          return;
        }

        stopStream(streamRef.current);
        streamRef.current = acquired;
        setStream(acquired);
        setStatus('ready');

        setActiveDeviceId(acquired.getVideoTracks()[0]?.getSettings().deviceId ?? null);
        await refreshDevices();
      } catch (error) {
        if (cancelled) return;
        setStatus('error');
        setFailure(classifyCameraError(error));
      }
    })();

    // Releasing here is what guarantees the camera light goes out on exit.
    return () => {
      cancelled = true;
      stopStream(streamRef.current);
      streamRef.current = null;
      setStream(null);
      setActiveDeviceId(null);
      setStatus('idle');
    };
  }, [enabled, requestedDeviceId, attempt, refreshDevices]);

  useEffect(() => {
    if (!enabled || !navigator.mediaDevices?.addEventListener) return;
    const onChange = () => void refreshDevices();
    navigator.mediaDevices.addEventListener('devicechange', onChange);
    return () => navigator.mediaDevices.removeEventListener('devicechange', onChange);
  }, [enabled, refreshDevices]);

  const selectDevice = useCallback((deviceId: string) => {
    setRequestedDeviceId((current) => (current === deviceId ? current : deviceId));
  }, []);

  const retry = useCallback(() => {
    setAttempt((value) => value + 1);
  }, []);

  return useMemo(
    () => ({
      status,
      stream,
      failure,
      devices,
      activeDeviceId,
      mirrored,
      selectDevice,
      setMirrored,
      retry,
    }),
    [status, stream, failure, devices, activeDeviceId, mirrored, selectDevice, retry],
  );
}

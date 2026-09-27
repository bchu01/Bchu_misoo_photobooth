'use client';

import type { CameraController } from '@/features/camera/useCamera';
import { Button } from './ui/Button';

/**
 * Camera picker and mirror toggle. Plain text status only — no filters, effects,
 * or sound in this release.
 */
export function CameraSettings({ camera }: { camera: CameraController }) {
  const { status, devices, activeDeviceId, mirrored, selectDevice, setMirrored, failure, retry } =
    camera;

  const statusText =
    status === 'ready'
      ? 'Camera on'
      : status === 'requesting'
        ? 'Asking for camera access…'
        : status === 'error'
          ? 'Camera unavailable'
          : 'Camera off';

  return (
    <section aria-labelledby="camera-settings-heading" className="flex flex-col gap-4 tracking-[-0.05em]">
      <h2 id="camera-settings-heading" className="text-lg">
        Camera settings
      </h2>

      <p className="text-sm">
        <span className="font-medium">Status:</span> {statusText}
      </p>

      <div className="flex flex-col gap-1">
        <label htmlFor="camera-select" className="text-sm font-medium">
          Camera
        </label>
        <select
          id="camera-select"
          className="min-h-11 rounded-[21px] border border-black bg-white px-3 py-2 text-base disabled:opacity-50"
          value={activeDeviceId ?? ''}
          disabled={devices.length === 0}
          onChange={(event) => selectDevice(event.target.value)}
        >
          {devices.length === 0 ? (
            <option value="">No cameras detected</option>
          ) : (
            devices.map((device) => (
              <option key={device.deviceId} value={device.deviceId}>
                {device.label}
              </option>
            ))
          )}
        </select>
        {devices.length === 1 ? (
          <p className="text-xs">Only one camera is available on this device.</p>
        ) : null}
      </div>

      <div className="flex items-center gap-3">
        <input
          id="mirror-toggle"
          type="checkbox"
          className="size-5"
          checked={mirrored}
          onChange={(event) => setMirrored(event.target.checked)}
        />
        <label htmlFor="mirror-toggle" className="text-sm">
          Mirror my camera
        </label>
      </div>
      <p className="text-xs">
        Mirroring changes your preview and your saved frames in the same way. It does not affect
        your friend&apos;s camera.
      </p>

      {failure?.retryable ? (
        <Button variant="secondary" onClick={retry}>
          Try camera again
        </Button>
      ) : null}
    </section>
  );
}

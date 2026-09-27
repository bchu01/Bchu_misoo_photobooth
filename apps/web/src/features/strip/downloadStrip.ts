/** Filename convention and the browser save step. */

export type PhotoboothMode = 'solo' | 'pair';

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0');
}

/**
 * `bchu-misoo-solo-YYYYMMDD-HHMM.png`, using the downloading device's local
 * time so each participant's file reflects their own clock.
 */
export function stripFileName(mode: PhotoboothMode, at: Date = new Date()): string {
  const stamp =
    `${at.getFullYear()}${pad(at.getMonth() + 1)}${pad(at.getDate())}` +
    `-${pad(at.getHours())}${pad(at.getMinutes())}`;
  return `bchu-misoo-${mode}-${stamp}.png`;
}

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.rel = 'noopener';
  document.body.append(link);
  link.click();
  link.remove();
  // Revoked on the next tick so the download has already started.
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

/** Small async helpers shared by the capture sequences. */

export class CancelledError extends Error {
  constructor() {
    super('Cancelled');
    this.name = 'CancelledError';
  }
}

/** Resolves after `ms`, or rejects with `CancelledError` if aborted first. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new CancelledError());
      return;
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);

    function onAbort(): void {
      clearTimeout(timer);
      reject(new CancelledError());
    }

    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export function isCancelled(error: unknown): boolean {
  return error instanceof CancelledError || (error instanceof Error && error.name === 'AbortError');
}

/** Short random id used to make repeated commands idempotent server-side. */
export function newEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

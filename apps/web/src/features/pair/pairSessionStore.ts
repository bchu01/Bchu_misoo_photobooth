'use client';

/**
 * The reconnect token for the current room, kept in `sessionStorage`.
 *
 * This is the only thing the app persists. It is scoped to one tab, holds no
 * photo data, and is what makes `/pair/[roomCode]` reachable only for a room this
 * tab actually joined. A room code alone is an invitation, not authentication.
 */

import type { Role } from '@bchu/shared';

const STORAGE_KEY = 'bchu:pair-session';

export interface StoredPairSession {
  code: string;
  role: Role;
  reconnectToken: string;
}

function isValid(value: unknown): value is StoredPairSession {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<StoredPairSession>;
  return (
    typeof candidate.code === 'string' &&
    (candidate.role === 'host' || candidate.role === 'guest') &&
    typeof candidate.reconnectToken === 'string'
  );
}

export function savePairSession(session: StoredPairSession): void {
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  } catch {
    // Private browsing modes can refuse storage; the live socket still works.
  }
}

export function loadPairSession(code?: string): StoredPairSession | null {
  try {
    const raw = sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return null;

    const parsed: unknown = JSON.parse(raw);
    if (!isValid(parsed)) return null;
    if (code && parsed.code !== code) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function clearPairSession(): void {
  try {
    sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    // Nothing to clean up if storage is unavailable.
  }
}

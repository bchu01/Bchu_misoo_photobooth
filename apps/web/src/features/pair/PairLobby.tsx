'use client';

/**
 * Pair lobby: create a room, or join one with a code.
 *
 * Membership is established here and stored as a per-tab reconnect token, then
 * the room page resumes with it. An invalid code is reported as-is and never
 * turns into a newly created room.
 */

import { useCallback, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ROOM_CODE_LENGTH, ROOM_CODE_PATTERN } from '@bchu/shared';
import type { RoomMembership } from '@bchu/shared';
import { StatusMessage } from '@/components/StatusMessage';
import { Button } from '@/components/ui/Button';
import { ensureConnected, getSocket, request } from '@/lib/socketClient';
import { savePairSession } from './pairSessionStore';

type Busy = 'none' | 'creating' | 'joining';

export function PairLobby() {
  const router = useRouter();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState<Busy>('none');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  const enterRoom = useCallback(
    (membership: RoomMembership) => {
      savePairSession({
        code: membership.code,
        role: membership.role,
        reconnectToken: membership.reconnectToken,
      });
      router.push(`/pair/${membership.code}`);
    },
    [router],
  );

  const createParty = useCallback(async () => {
    setBusy('creating');
    setError(null);
    try {
      const socket = await ensureConnected(getSocket());
      const membership = await request(socket, 'room:create', {});
      enterRoom(membership);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a party.');
      setBusy('none');
    }
  }, [enterRoom]);

  const joinParty = useCallback(async () => {
    const normalized = code.trim().toUpperCase();
    if (!ROOM_CODE_PATTERN.test(normalized)) {
      setError(`Enter the ${ROOM_CODE_LENGTH}-character code your friend sent you.`);
      inputRef.current?.focus();
      return;
    }

    setBusy('joining');
    setError(null);
    try {
      const socket = await ensureConnected(getSocket());
      const membership = await request(socket, 'room:join', { code: normalized });
      enterRoom(membership);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not join that party.');
      setBusy('none');
    }
  }, [code, enterRoom]);

  return (
    <div className="flex flex-col gap-6">
      {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}

      <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <section aria-labelledby="create-heading" className="flex flex-col gap-3">
          <h2 id="create-heading" className="text-lg font-semibold">
            Create party
          </h2>
          <p className="text-sm text-zinc-700">
            You become the host. You will get a six-character code to share, and only you can start
            the photo sequence.
          </p>
          <Button
            variant="primary"
            className="self-start"
            onClick={() => void createParty()}
            disabled={busy !== 'none'}
          >
            {busy === 'creating' ? 'Creating…' : 'Create party'}
          </Button>
        </section>

        <section aria-labelledby="join-heading" className="flex flex-col gap-3">
          <h2 id="join-heading" className="text-lg font-semibold">
            Join party
          </h2>
          <form
            className="flex flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void joinParty();
            }}
          >
            <div className="flex flex-col gap-1">
              <label htmlFor="room-code" className="text-sm font-medium">
                Party code
              </label>
              <input
                id="room-code"
                ref={inputRef}
                value={code}
                onChange={(event) => setCode(event.target.value.toUpperCase())}
                maxLength={ROOM_CODE_LENGTH}
                autoCapitalize="characters"
                autoComplete="off"
                spellCheck={false}
                inputMode="text"
                placeholder="ABC234"
                aria-describedby="room-code-hint"
                className="min-h-11 w-full max-w-56 rounded-md border border-zinc-400 bg-white px-3 py-2 font-mono text-lg tracking-widest uppercase"
              />
              <p id="room-code-hint" className="text-xs text-zinc-600">
                Six letters or numbers, not case sensitive.
              </p>
            </div>
            <Button variant="primary" type="submit" className="self-start" disabled={busy !== 'none'}>
              {busy === 'joining' ? 'Joining…' : 'Join'}
            </Button>
          </form>
        </section>
      </div>

      <p className="max-w-prose text-xs text-zinc-600">
        A party code is an invitation, not a password: anyone who has it can try to take the empty
        second seat. Rooms hold two people, expire after 30 minutes, and disappear if the server
        restarts.
      </p>
    </div>
  );
}

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
import { BoothWindow } from '@/components/brand/BoothWindow';
import { PillButton } from '@/components/brand/PillButton';
import { StatusMessage } from '@/components/StatusMessage';
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
    <main className="mx-auto flex w-full max-w-[1440px] flex-col items-center gap-6 px-3 py-8">
      <BoothWindow
        footer={
          <div className="flex flex-col items-stretch justify-between gap-6 sm:flex-row sm:items-end">
            <PillButton onClick={() => void createParty()} disabled={busy !== 'none'} className="sm:w-[248px]">
              {busy === 'creating' ? 'Creating…' : 'Create a DUO'}
            </PillButton>

            <form
              className="flex w-full flex-col gap-3 sm:w-[248px]"
              onSubmit={(event) => {
                event.preventDefault();
                void joinParty();
              }}
            >
              <label className="sr-only" htmlFor="room-code">
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
                placeholder="######"
                aria-describedby="room-code-hint"
                className="h-[75px] w-full rounded-[21px] border border-black bg-[#efefef] px-4 text-center text-3xl tracking-[0.31em] uppercase placeholder:tracking-[0.31em]"
              />
              <p id="room-code-hint" className="sr-only">
                Six letters or numbers, not case sensitive.
              </p>
              <PillButton type="submit" disabled={busy !== 'none'}>
                {busy === 'joining' ? 'Joining…' : 'Join a DUO'}
              </PillButton>
            </form>
          </div>
        }
      >
        <div className="flex h-[36vh] min-h-48 max-h-[420px] items-start justify-center p-4">
          {error ? <StatusMessage tone="error">{error}</StatusMessage> : null}
        </div>
      </BoothWindow>
    </main>
  );
}

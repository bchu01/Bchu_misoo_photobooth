'use client';

import { useState } from 'react';
import type { ParticipantState, Role, RoomState } from '@bchu/shared';
import { Button } from './ui/Button';

/**
 * Room code, copy control, and who is connected.
 *
 * Presence is stated in words as well as position, so connection status never
 * depends on colour alone.
 */
export interface PairStatusProps {
  roomState: RoomState;
  myRole: Role | null;
  connectionLabel: string;
  onLeave: () => void;
}

function participantLine(role: Role, participant: ParticipantState | null, myRole: Role | null): string {
  const who = role === 'host' ? 'Host' : 'Guest';
  const you = role === myRole ? ' (you)' : '';

  if (!participant) return `${who}${you}: not here yet`;
  if (!participant.connected) return `${who}${you}: disconnected, waiting to rejoin`;
  if (!participant.cameraReady) return `${who}${you}: connected, camera not ready`;
  if (!participant.dataChannelReady) return `${who}${you}: camera on, still linking up`;
  return `${who}${you}: ready`;
}

export function PairStatus({ roomState, myRole, connectionLabel, onLeave }: PairStatusProps) {
  const [copied, setCopied] = useState(false);

  const copyCode = async () => {
    try {
      await navigator.clipboard.writeText(roomState.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-labelledby="pair-status-heading" className="flex flex-col gap-2 tracking-[-0.05em]">
      <h2 id="pair-status-heading" className="sr-only">
        Room
      </h2>

      <div className="flex flex-wrap items-center gap-3">
        <p className="text-sm">
          <span>Code:</span> <span className="font-mono text-lg tracking-[0.2em]">{roomState.code}</span>
        </p>
        <Button variant="secondary" onClick={() => void copyCode()}>
          {copied ? 'Copied' : 'Copy code'}
        </Button>
        <Button variant="quiet" onClick={onLeave}>
          Leave
        </Button>
      </div>

      <p className="text-sm" aria-live="polite">
        {connectionLabel}. {participantLine('host', roomState.host, myRole)}. {participantLine('guest', roomState.guest, myRole)}.
      </p>
    </section>
  );
}

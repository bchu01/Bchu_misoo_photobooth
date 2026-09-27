'use client';

/**
 * Pair photobooth room. A composition layer only: room rules, negotiation, and
 * transfer all live in their own modules.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SHOTS_PER_SESSION } from '@bchu/shared';
import { CameraPreview } from '@/components/CameraPreview';
import { CameraSettings } from '@/components/CameraSettings';
import { PageShell } from '@/components/PageShell';
import { PairStatus } from '@/components/PairStatus';
import { PhotoStripPreview } from '@/components/PhotoStripPreview';
import { StatusMessage } from '@/components/StatusMessage';
import { Button } from '@/components/ui/Button';
import { useCamera } from '@/features/camera/useCamera';
import { downloadBlob, stripFileName } from '@/features/strip/downloadStrip';
import { renderStripPng } from '@/features/strip/renderStrip';
import { useIceServers } from './useIceServers';
import { usePairPhotobooth } from './usePairPhotobooth';
import { usePairRoom } from './usePairRoom';
import { usePeerConnection } from './usePeerConnection';

const PEER_STATE_LABELS: Record<string, string> = {
  idle: 'Waiting for both cameras before connecting',
  negotiating: 'Connecting to your friend…',
  connected: 'Connected to your friend',
  interrupted: 'Connection interrupted, trying to recover',
  failed: 'Could not connect to your friend',
  closed: 'Not connected',
};

export function PairPhotobooth({ code }: { code: string }) {
  const router = useRouter();
  const room = usePairRoom(code);
  // Callbacks on the controller are stable; the controller object itself is not.
  const { connection, reportReady, leave: leaveRoom } = room;
  const camera = useCamera(connection === 'joined');
  const ice = useIceServers();
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const [isSaving, setIsSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [commandError, setCommandError] = useState<string | null>(null);

  const myRole = room.role;
  const peerParticipant = myRole === 'host' ? room.roomState?.guest : room.roomState?.host;
  const peerCameraReady = Boolean(peerParticipant?.connected && peerParticipant.cameraReady);

  const peer = usePeerConnection({
    socket: room.socket,
    role: myRole,
    localStream: camera.stream,
    peerCameraReady,
    iceServers: ice.iceServers,
  });

  const booth = usePairPhotobooth({
    room,
    channel: peer.channel,
    channelOpen: peer.channelOpen,
    videoRef,
    mirrored: camera.mirrored,
  });

  /**
   * Readiness is what the server uses to gate negotiation and capture. Only
   * stable values are depended on here: depending on the whole room controller
   * would re-report on every `room:state` broadcast, and each report triggers
   * another broadcast.
   */
  const cameraReady = camera.status === 'ready' && camera.stream !== null;
  useEffect(() => {
    if (connection !== 'joined') return;
    reportReady({ cameraReady, dataChannelReady: peer.channelOpen });
  }, [connection, reportReady, cameraReady, peer.channelOpen]);

  const leave = useCallback(async () => {
    await leaveRoom();
    router.push('/pair');
  }, [leaveRoom, router]);

  const runCommand = useCallback(async (command: () => Promise<unknown>) => {
    setCommandError(null);
    try {
      await command();
    } catch (cause) {
      setCommandError(cause instanceof Error ? cause.message : 'That action was rejected.');
    }
  }, []);

  const download = useCallback(async () => {
    if (!booth.completeSlots) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const png = await renderStripPng(booth.completeSlots);
      downloadBlob(png, stripFileName('pair'));
    } catch (cause) {
      setSaveError(cause instanceof Error ? cause.message : 'Could not save the photo strip.');
    } finally {
      setIsSaving(false);
    }
  }, [booth.completeSlots]);

  /* ------------------------------ gated states ----------------------------- */

  if (connection === 'unauthorized') {
    return (
      <PageShell title="Pair" backHref="/pair">
        <StatusMessage
          tone="error"
          action={
            <Button variant="primary" onClick={() => router.push('/pair')}>
              Back to Pair
            </Button>
          }
        >
          This tab is not part of room {code}. Create a party or join with the code from the Pair
          screen.
        </StatusMessage>
      </PageShell>
    );
  }

  if (connection === 'connecting' || !room.roomState) {
    return (
      <PageShell title="Pair" backHref="/pair">
        <StatusMessage>Joining room {code}…</StatusMessage>
      </PageShell>
    );
  }

  /* -------------------------------- room UI -------------------------------- */

  const roomState = room.roomState;
  const bothReady =
    Boolean(roomState.host?.cameraReady && roomState.host.dataChannelReady) &&
    Boolean(roomState.guest?.cameraReady && roomState.guest.dataChannelReady);

  const sequenceRunning = roomState.status === 'capturing' && roomState.shotStatus !== 'idle';
  const sessionComplete = roomState.completedShots.length >= SHOTS_PER_SESSION;
  const canStart = room.isHost && bothReady && !sequenceRunning && roomState.status !== 'expired';
  const canRetake = room.isHost && !sequenceRunning && roomState.completedShots.length > 0;

  const waitingForFriend = roomState.status === 'waiting';
  const localLabel = myRole === 'host' ? 'You (Host)' : 'You (Guest)';
  const remoteLabel = myRole === 'host' ? 'Your friend (Guest)' : 'Your friend (Host)';

  return (
    <PageShell title="Pair" backHref="/pair">
      <div className="flex flex-col gap-6">
        <PairStatus
          roomState={roomState}
          myRole={myRole}
          connectionLabel={PEER_STATE_LABELS[peer.state] ?? 'Unknown'}
          onLeave={() => void leave()}
        />

        {room.error ? <StatusMessage tone="error">{room.error.message}</StatusMessage> : null}
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
        {peer.error ? (
          <StatusMessage
            tone="error"
            action={
              <Button variant="secondary" onClick={peer.restart}>
                Reconnect
              </Button>
            }
          >
            {peer.error}
          </StatusMessage>
        ) : null}
        {ice.degraded ? (
          <StatusMessage>
            Relay settings could not be loaded, so this connection may fail on restrictive networks.
          </StatusMessage>
        ) : null}
        {booth.problem ? <StatusMessage tone="error">{booth.problem}</StatusMessage> : null}
        {commandError ? <StatusMessage tone="error">{commandError}</StatusMessage> : null}
        {saveError ? <StatusMessage tone="error">{saveError}</StatusMessage> : null}

        {waitingForFriend ? (
          <StatusMessage>Waiting for a friend. Share the code above to let them in.</StatusMessage>
        ) : null}
        {booth.transferNote ? <StatusMessage>{booth.transferNote}</StatusMessage> : null}
        {sessionComplete ? (
          <StatusMessage tone="success">
            All {SHOTS_PER_SESSION} frames are complete on both devices. You can download the strip.
          </StatusMessage>
        ) : null}

        {/* Reading order on narrow screens: settings, cameras, strip, actions. */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)_minmax(12rem,16rem)]">
          <CameraSettings camera={camera} />

          <div className="grid min-w-0 grid-cols-1 gap-4 sm:grid-cols-2">
            <CameraPreview
              label={localLabel}
              stream={camera.stream}
              mirrored={camera.mirrored}
              videoRef={videoRef}
              countdownSeconds={booth.countdownSeconds}
              badge={booth.activeShot ? `Shot ${booth.activeShot} of ${SHOTS_PER_SESSION}` : undefined}
              placeholder={
                camera.status === 'requesting' ? 'Waiting for camera permission…' : 'Camera is off.'
              }
            />
            <CameraPreview
              label={remoteLabel}
              stream={peer.remoteStream}
              placeholder={
                waitingForFriend
                  ? 'Waiting for a friend to join.'
                  : peer.state === 'failed'
                    ? 'Could not connect to their camera.'
                    : 'Connecting to their camera…'
              }
            />
          </div>

          <PhotoStripPreview slots={booth.slots} activeShot={booth.activeShot} />
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-zinc-300 pt-4">
          <div className="flex flex-wrap items-center gap-3">
            {room.isHost ? (
              <>
                <Button
                  variant="primary"
                  onClick={() => void runCommand(room.startCapture)}
                  disabled={!canStart}
                >
                  {sequenceRunning ? 'Taking photos…' : 'Take photos'}
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => void runCommand(room.retake)}
                  disabled={!canRetake}
                >
                  Retake
                </Button>
              </>
            ) : (
              <p className="text-sm text-zinc-700">
                The host starts and retakes the photo sequence.
              </p>
            )}
          </div>

          <Button
            variant="primary"
            onClick={() => void download()}
            disabled={!booth.completeSlots || isSaving}
          >
            {isSaving ? 'Preparing PNG…' : 'Download PNG'}
          </Button>
        </div>

        <p className="max-w-prose text-xs text-zinc-600">
          Photos travel directly between the two browsers and are never stored on the server. They
          live in memory only: if you reload or leave before downloading, they are gone. On some
          networks a relay server forwards the encrypted connection on your behalf.
        </p>
      </div>
    </PageShell>
  );
}

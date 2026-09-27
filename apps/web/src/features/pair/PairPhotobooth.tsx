'use client';

/**
 * Pair photobooth room. A composition layer only: room rules, negotiation, and
 * transfer all live in their own modules.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { SHOTS_PER_SESSION } from '@bchu/shared';
import { BoothShelf } from '@/components/brand/BoothShelf';
import { BoothWindow } from '@/components/brand/BoothWindow';
import { CameraPreview } from '@/components/CameraPreview';
import { CameraSettings } from '@/components/CameraSettings';
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
      <main className="mx-auto flex w-[min(720px,calc(100%-1.5rem))] justify-center py-16">
        <StatusMessage
          tone="error"
          action={
            <Button variant="primary" onClick={() => router.push('/pair')}>
              Back to Duo
            </Button>
          }
        >
          This tab is not part of room {code}. Create a duo or join with the code from the Duo
          screen.
        </StatusMessage>
      </main>
    );
  }

  if (connection === 'connecting' || !room.roomState) {
    return (
      <main className="mx-auto flex w-[min(720px,calc(100%-1.5rem))] justify-center py-16">
        <StatusMessage>Joining room {code}…</StatusMessage>
      </main>
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

  const localPreview = (
    <CameraPreview
      bare
      label={localLabel}
      stream={camera.stream}
      mirrored={camera.mirrored}
      videoRef={videoRef}
      countdownSeconds={booth.countdownSeconds}
      badge={booth.activeShot ? `Shot ${booth.activeShot} of ${SHOTS_PER_SESSION}` : undefined}
      placeholder={camera.status === 'requesting' ? 'Waiting for camera permission…' : 'Camera is off.'}
    />
  );
  const remotePreview = (
    <CameraPreview
      bare
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
  );

  const shutterDisabled = !room.isHost || sequenceRunning || (!canStart && !canRetake);
  const shutterLabel = sequenceRunning ? 'Taking photos' : sessionComplete ? 'Retake' : 'Take photos';

  return (
    <main className="mx-auto flex w-full max-w-[1440px] flex-col items-center gap-6 px-3 py-8">
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
      {booth.transferNote ? <StatusMessage>{booth.transferNote}</StatusMessage> : null}
      {sessionComplete ? (
        <StatusMessage tone="success">
          All {SHOTS_PER_SESSION} frames are complete on both devices. You can download the strip.
        </StatusMessage>
      ) : null}

      <BoothWindow
        footer={
          <div className="flex flex-col gap-4">
            <PairStatus
              roomState={roomState}
              myRole={myRole}
              connectionLabel={PEER_STATE_LABELS[peer.state] ?? 'Unknown'}
              onLeave={() => void leave()}
            />
            <BoothShelf
              mode="duo"
              shutterLabel={shutterLabel}
              shutterDisabled={shutterDisabled}
              onShutter={() => {
                if (canStart) void runCommand(room.startCapture);
                else if (canRetake) void runCommand(room.retake);
              }}
              downloadLabel={isSaving ? 'Preparing…' : 'Download'}
              downloadDisabled={!booth.completeSlots || isSaving}
              onDownload={() => void download()}
              note={
                waitingForFriend
                  ? 'Waiting for a friend. Share the code so they can join. Host is on the left.'
                  : room.isHost
                    ? 'You start the photos. Host is on the left, guest on the right.'
                    : 'The host starts and retakes the photo sequence. Host is on the left.'
              }
            />
            {room.isHost && canRetake ? (
              <div className="text-center">
                <Button variant="quiet" onClick={() => void runCommand(room.retake)} disabled={sequenceRunning}>
                  Clear strip
                </Button>
              </div>
            ) : null}
          </div>
        }
      >
        <div className="grid h-[42vh] min-h-64 max-h-[507px] grid-cols-1 divide-y divide-black sm:grid-cols-2 sm:divide-x sm:divide-y-0">
          {myRole === 'host' ? localPreview : remotePreview}
          {myRole === 'host' ? remotePreview : localPreview}
        </div>
      </BoothWindow>

      <PhotoStripPreview slots={booth.slots} activeShot={booth.activeShot} />

      <details className="w-[min(988px,calc(100%-1.5rem))] rounded-[28px] border border-black bg-[rgba(243,243,243,0.74)] p-4">
        <summary className="cursor-pointer text-lg tracking-[-0.05em]">Camera</summary>
        <div className="pt-4">
          <CameraSettings camera={camera} />
        </div>
      </details>
    </main>
  );
}

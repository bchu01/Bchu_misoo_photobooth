'use client';

/**
 * One RTCPeerConnection per room, carrying live video and a data channel for
 * still images. SDP and ICE go through the signaling service; media and photos do
 * not.
 *
 * The host is always the offerer and owns the data channel, which keeps
 * negotiation single-sided and avoids offer glare. Negotiation waits until the
 * server reports that both cameras are live, so neither side can offer into a
 * peer that has not built its connection yet.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { STILL_CHANNEL_LABEL } from '@bchu/shared';
import type { IceServerConfig, PeerSignalEvent, Role } from '@bchu/shared';
import { request, type PhotoboothSocket } from '@/lib/socketClient';

export type PeerState = 'idle' | 'negotiating' | 'connected' | 'interrupted' | 'failed' | 'closed';

export interface PeerConnectionController {
  state: PeerState;
  remoteStream: MediaStream | null;
  channel: RTCDataChannel | null;
  channelOpen: boolean;
  error: string | null;
  /** Rebuilds the connection from scratch, e.g. after an ICE failure. */
  restart: () => void;
}

export interface UsePeerConnectionOptions {
  socket: PhotoboothSocket;
  role: Role | null;
  localStream: MediaStream | null;
  /** True once the server reports the other participant's camera is live. */
  peerCameraReady: boolean;
  iceServers: IceServerConfig[] | null;
}

/** Maps the browser's connection state onto the states this app talks about. */
const PEER_STATES: Partial<Record<RTCPeerConnectionState, PeerState>> = {
  connected: 'connected',
  disconnected: 'interrupted',
  failed: 'failed',
  closed: 'closed',
};

export function usePeerConnection({
  socket,
  role,
  localStream,
  peerCameraReady,
  iceServers,
}: UsePeerConnectionOptions): PeerConnectionController {
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [channel, setChannel] = useState<RTCDataChannel | null>(null);
  const [channelOpen, setChannelOpen] = useState(false);
  const [generation, setGeneration] = useState(0);

  const ready = Boolean(role && localStream && iceServers && peerCameraReady);

  /**
   * Every rebuild gets a key. Connection state and errors are stamped with the
   * key they came from, so a stale value is ignored during render instead of
   * being cleared by a follow-up state update.
   */
  const connectionKey = `${generation}:${role}:${ready}`;
  const [reported, setReported] = useState<{ key: string; state: RTCPeerConnectionState } | null>(null);
  const [reportedError, setReportedError] = useState<{ key: string; message: string } | null>(null);

  const state: PeerState = !ready
    ? 'idle'
    : reported?.key === connectionKey
      ? (PEER_STATES[reported.state] ?? 'negotiating')
      : 'negotiating';

  const error = reportedError?.key === connectionKey ? reportedError.message : null;

  /**
   * Signals can arrive before the connection exists, so the socket listener is
   * mounted independently and queues anything the connection is not ready for.
   */
  const handlerRef = useRef<((event: PeerSignalEvent) => void) | null>(null);
  const queueRef = useRef<PeerSignalEvent[]>([]);

  useEffect(() => {
    const onSignal = (event: PeerSignalEvent) => {
      const handler = handlerRef.current;
      if (handler) handler(event);
      else queueRef.current.push(event);
    };

    socket.on('peer:signal', onSignal);
    return () => {
      socket.off('peer:signal', onSignal);
    };
  }, [socket]);

  const restart = useCallback(() => {
    setGeneration((value) => value + 1);
  }, []);

  useEffect(() => {
    if (!role || !localStream || !iceServers || !peerCameraReady) return;

    const connection = new RTCPeerConnection({ iceServers, bundlePolicy: 'max-bundle' });
    let closed = false;
    // ICE candidates are useless until a remote description exists.
    let remoteDescriptionSet = false;
    const pendingCandidates: RTCIceCandidateInit[] = [];

    const fail = (message: string) => {
      if (!closed) setReportedError({ key: connectionKey, message });
    };

    const send = (type: PeerSignalEvent['type'], data: unknown) => {
      void request(socket, 'peer:signal', { type, data: JSON.stringify(data) }).catch(() => {
        fail('Could not reach your friend through the server.');
      });
    };

    for (const track of localStream.getVideoTracks()) {
      connection.addTrack(track, localStream);
    }

    const attachChannel = (dataChannel: RTCDataChannel) => {
      dataChannel.addEventListener('open', () => {
        if (closed) return;
        setChannelOpen(true);
      });
      dataChannel.addEventListener('close', () => {
        if (closed) return;
        setChannelOpen(false);
      });
      setChannel(dataChannel);
    };

    if (role === 'host') {
      attachChannel(connection.createDataChannel(STILL_CHANNEL_LABEL, { ordered: true }));
    } else {
      connection.addEventListener('datachannel', (event) => {
        if (event.channel.label === STILL_CHANNEL_LABEL) attachChannel(event.channel);
      });
    }

    connection.addEventListener('track', (event) => {
      if (closed) return;
      const [stream] = event.streams;
      if (stream) setRemoteStream(stream);
    });

    connection.addEventListener('icecandidate', (event) => {
      if (event.candidate) send('ice', event.candidate.toJSON());
    });

    connection.addEventListener('connectionstatechange', () => {
      if (closed) return;
      setReported({ key: connectionKey, state: connection.connectionState });

      if (connection.connectionState === 'failed') {
        fail('Could not open a direct connection. A relay server may be required on this network.');
      }
    });

    // Only the host offers, so this fires on one side and never collides.
    if (role === 'host') {
      connection.addEventListener('negotiationneeded', () => {
        void (async () => {
          try {
            const offer = await connection.createOffer();
            await connection.setLocalDescription(offer);
            if (!closed && connection.localDescription) send('offer', connection.localDescription);
          } catch {
            fail('Could not start the video connection.');
          }
        })();
      });
    }

    const drainCandidates = async () => {
      while (pendingCandidates.length > 0) {
        const candidate = pendingCandidates.shift();
        if (!candidate) continue;
        try {
          await connection.addIceCandidate(candidate);
        } catch {
          // A rejected candidate is normal; others may still succeed.
        }
      }
    };

    const handleSignal = (event: PeerSignalEvent) => {
      void (async () => {
        let payload: unknown;
        try {
          payload = JSON.parse(event.data);
        } catch {
          return;
        }

        try {
          if (event.type === 'offer' && role === 'guest') {
            await connection.setRemoteDescription(payload as RTCSessionDescriptionInit);
            remoteDescriptionSet = true;
            await drainCandidates();

            const answer = await connection.createAnswer();
            await connection.setLocalDescription(answer);
            if (!closed && connection.localDescription) send('answer', connection.localDescription);
            return;
          }

          if (event.type === 'answer' && role === 'host') {
            await connection.setRemoteDescription(payload as RTCSessionDescriptionInit);
            remoteDescriptionSet = true;
            await drainCandidates();
            return;
          }

          if (event.type === 'ice') {
            const candidate = payload as RTCIceCandidateInit;
            if (remoteDescriptionSet) await connection.addIceCandidate(candidate);
            else pendingCandidates.push(candidate);
          }
        } catch {
          fail('The video connection could not be negotiated.');
        }
      })();
    };

    handlerRef.current = handleSignal;
    const queued = queueRef.current;
    queueRef.current = [];
    for (const event of queued) handleSignal(event);

    return () => {
      closed = true;
      handlerRef.current = null;
      connection.getSenders().forEach((sender) => {
        try {
          connection.removeTrack(sender);
        } catch {
          // Already detached during connection teardown.
        }
      });
      connection.close();
      setChannel(null);
      setChannelOpen(false);
      setRemoteStream(null);
    };
  }, [socket, role, localStream, iceServers, peerCameraReady, generation, connectionKey]);

  return useMemo(
    () => ({ state, remoteStream, channel, channelOpen, error, restart }),
    [state, remoteStream, channel, channelOpen, error, restart],
  );
}

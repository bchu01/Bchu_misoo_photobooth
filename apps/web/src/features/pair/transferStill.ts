'use client';

/**
 * Still image transfer over the RTCDataChannel.
 *
 * Images travel peer to peer only. Each still is sent as bounded JPEG chunks with
 * an identifying header, and the receiver verifies the reassembled bytes before
 * acknowledging. Handles backpressure, duplicate and out-of-order chunks, missing
 * chunks, and timeouts. No image bytes are ever logged.
 *
 * Wire format:
 *   control: JSON text messages validated by `stillControlSchema`
 *   chunk:   [uint32 transferSeq][uint32 chunkIndex][payload bytes]
 */

import {
  DATA_CHANNEL_HIGH_WATER_BYTES,
  MAX_STILL_BYTES,
  SHOT_TRANSFER_TIMEOUT_MS,
  STILL_CHUNK_HEADER_BYTES,
  STILL_CHUNK_PAYLOAD_BYTES,
  stillControlSchema,
} from '@bchu/shared';
import type { Role, StillControlMessage } from '@bchu/shared';

export interface IncomingStill {
  sessionId: string;
  shotNumber: number;
  /** The role that captured this still, used for host-left export ordering. */
  role: Role;
  blob: Blob;
}

export interface StillMeta {
  sessionId: string;
  shotNumber: number;
  role: Role;
}

export interface StillTransportHandlers {
  onStill: (still: IncomingStill) => void;
  onFailure: (message: string) => void;
}

export interface StillTransport {
  /** Resolves once the peer confirms it holds the complete image. */
  send: (meta: StillMeta, blob: Blob) => Promise<void>;
  /** Drops in-flight state, e.g. after a retake issues a new session id. */
  reset: (sessionId: string) => void;
  dispose: () => void;
}

export class TransferError extends Error {}

/** FNV-1a: cheap integrity check against truncated or mixed-up reassembly. */
export function fnv1a32(bytes: Uint8Array): number {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

interface Assembly {
  meta: Extract<StillControlMessage, { kind: 'still-begin' }>;
  bytes: Uint8Array;
  received: boolean[];
  receivedCount: number;
}

interface PendingSend {
  transferSeq: number;
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export function createStillTransport(
  channel: RTCDataChannel,
  handlers: StillTransportHandlers,
): StillTransport {
  channel.binaryType = 'arraybuffer';
  channel.bufferedAmountLowThreshold = Math.floor(DATA_CHANNEL_HIGH_WATER_BYTES / 2);

  let nextTransferSeq = 1;
  let disposed = false;
  let assembly: Assembly | null = null;
  const pendingSends = new Map<number, PendingSend>();

  function sendControl(message: StillControlMessage): void {
    if (channel.readyState !== 'open') return;
    channel.send(JSON.stringify(message));
  }

  function settle(transferSeq: number, error?: Error): void {
    const pending = pendingSends.get(transferSeq);
    if (!pending) return;
    pendingSends.delete(transferSeq);
    clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve();
  }

  /** Waits for the send buffer to drain so a slow link is not overrun. */
  function waitForDrain(): Promise<void> {
    if (channel.bufferedAmount <= DATA_CHANNEL_HIGH_WATER_BYTES) return Promise.resolve();

    return new Promise((resolve, reject) => {
      const onLow = () => {
        cleanup();
        resolve();
      };
      // Not every implementation fires bufferedamountlow reliably, so poll too.
      const poll = setInterval(() => {
        if (channel.readyState !== 'open') {
          cleanup();
          reject(new TransferError('The connection to your friend dropped mid-transfer.'));
          return;
        }
        if (channel.bufferedAmount <= DATA_CHANNEL_HIGH_WATER_BYTES) {
          cleanup();
          resolve();
        }
      }, 50);

      function cleanup(): void {
        clearInterval(poll);
        channel.removeEventListener('bufferedamountlow', onLow);
      }

      channel.addEventListener('bufferedamountlow', onLow);
    });
  }

  function handleBegin(message: Extract<StillControlMessage, { kind: 'still-begin' }>): void {
    // Only one inbound transfer at a time; a newer one supersedes the old.
    assembly = {
      meta: message,
      bytes: new Uint8Array(message.byteSize),
      received: Array.from({ length: message.chunkCount }, () => false),
      receivedCount: 0,
    };
  }

  function handleAck(message: Extract<StillControlMessage, { kind: 'still-ack' }>): void {
    if (message.ok) {
      settle(message.transferSeq);
    } else {
      settle(
        message.transferSeq,
        new TransferError('Your friend could not read that photo. The shot will be retaken.'),
      );
    }
  }

  function handleChunk(buffer: ArrayBuffer): void {
    if (!assembly) return;
    if (buffer.byteLength <= STILL_CHUNK_HEADER_BYTES) return;

    const view = new DataView(buffer);
    const transferSeq = view.getUint32(0);
    const chunkIndex = view.getUint32(4);

    if (transferSeq !== assembly.meta.transferSeq) return;
    if (chunkIndex >= assembly.meta.chunkCount) return;
    if (assembly.received[chunkIndex]) return; // Duplicate chunk.

    const payload = new Uint8Array(buffer, STILL_CHUNK_HEADER_BYTES);
    const offset = chunkIndex * STILL_CHUNK_PAYLOAD_BYTES;
    if (offset + payload.byteLength > assembly.meta.byteSize) {
      const failed = assembly;
      assembly = null;
      sendControl({
        kind: 'still-ack',
        transferSeq: failed.meta.transferSeq,
        sessionId: failed.meta.sessionId,
        shotNumber: failed.meta.shotNumber,
        ok: false,
      });
      handlers.onFailure('A photo arrived malformed and was discarded.');
      return;
    }

    assembly.bytes.set(payload, offset);
    assembly.received[chunkIndex] = true;
    assembly.receivedCount += 1;

    if (assembly.receivedCount < assembly.meta.chunkCount) return;

    const complete = assembly;
    assembly = null;

    const checksumOk = fnv1a32(complete.bytes) === complete.meta.checksum;
    sendControl({
      kind: 'still-ack',
      transferSeq: complete.meta.transferSeq,
      sessionId: complete.meta.sessionId,
      shotNumber: complete.meta.shotNumber,
      ok: checksumOk,
    });

    if (!checksumOk) {
      handlers.onFailure('A photo arrived damaged and was discarded.');
      return;
    }

    handlers.onStill({
      sessionId: complete.meta.sessionId,
      shotNumber: complete.meta.shotNumber,
      role: complete.meta.role,
      blob: new Blob([complete.bytes.buffer as ArrayBuffer], { type: complete.meta.mimeType }),
    });
  }

  function onMessage(event: MessageEvent<unknown>): void {
    if (disposed) return;

    if (typeof event.data === 'string') {
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(event.data);
      } catch {
        return;
      }

      // The peer is as untrusted as any other network input.
      const parsed = stillControlSchema.safeParse(parsedJson);
      if (!parsed.success) return;

      switch (parsed.data.kind) {
        case 'still-begin':
          handleBegin(parsed.data);
          return;
        case 'still-ack':
          handleAck(parsed.data);
          return;
        case 'still-reset':
          assembly = null;
          return;
      }
      return;
    }

    if (event.data instanceof ArrayBuffer) handleChunk(event.data);
  }

  function onClose(): void {
    assembly = null;
    for (const transferSeq of [...pendingSends.keys()]) {
      settle(transferSeq, new TransferError('The connection to your friend closed mid-transfer.'));
    }
  }

  channel.addEventListener('message', onMessage);
  channel.addEventListener('close', onClose);
  channel.addEventListener('error', onClose);

  async function send(meta: StillMeta, blob: Blob): Promise<void> {
    if (disposed) throw new TransferError('The photo connection is closed.');
    if (channel.readyState !== 'open') {
      throw new TransferError('The connection to your friend is not open.');
    }

    const bytes = new Uint8Array(await blob.arrayBuffer());
    if (bytes.byteLength > MAX_STILL_BYTES) {
      throw new TransferError('That photo was too large to send.');
    }

    const transferSeq = nextTransferSeq;
    nextTransferSeq += 1;
    const chunkCount = Math.max(1, Math.ceil(bytes.byteLength / STILL_CHUNK_PAYLOAD_BYTES));

    const acknowledged = new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        pendingSends.delete(transferSeq);
        reject(new TransferError('Your friend did not confirm that photo in time.'));
      }, SHOT_TRANSFER_TIMEOUT_MS);
      pendingSends.set(transferSeq, { transferSeq, resolve, reject, timer });
    });

    sendControl({
      kind: 'still-begin',
      transferSeq,
      sessionId: meta.sessionId,
      shotNumber: meta.shotNumber,
      role: meta.role,
      mimeType: 'image/jpeg',
      byteSize: bytes.byteLength,
      chunkCount,
      checksum: fnv1a32(bytes),
    });

    for (let index = 0; index < chunkCount; index += 1) {
      await waitForDrain();
      if (channel.readyState !== 'open') {
        settle(transferSeq, new TransferError('The connection to your friend dropped mid-transfer.'));
        break;
      }

      const start = index * STILL_CHUNK_PAYLOAD_BYTES;
      const payload = bytes.subarray(start, start + STILL_CHUNK_PAYLOAD_BYTES);

      const message = new ArrayBuffer(STILL_CHUNK_HEADER_BYTES + payload.byteLength);
      const view = new DataView(message);
      view.setUint32(0, transferSeq);
      view.setUint32(4, index);
      new Uint8Array(message, STILL_CHUNK_HEADER_BYTES).set(payload);

      channel.send(message);
    }

    await acknowledged;
  }

  return {
    send,
    reset: (sessionId: string) => {
      assembly = null;
      sendControl({ kind: 'still-reset', sessionId });
    },
    dispose: () => {
      disposed = true;
      channel.removeEventListener('message', onMessage);
      channel.removeEventListener('close', onClose);
      channel.removeEventListener('error', onClose);
      onClose();
    },
  };
}

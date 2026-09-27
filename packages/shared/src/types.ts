/** Domain types shared across the network boundary. No runtime dependencies. */

export type Role = 'host' | 'guest';

export type RoomStatus =
  | 'waiting'
  | 'connecting'
  | 'ready'
  | 'capturing'
  | 'complete'
  | 'expired';

export type ShotStatus = 'idle' | 'countdown' | 'transferring' | 'complete';

export type AckStage = 'local' | 'peer-received';

export type SignalType = 'offer' | 'answer' | 'ice';

export type RoomErrorCode =
  | 'INVALID_PAYLOAD'
  | 'INVALID_CODE'
  | 'NOT_FOUND'
  | 'FULL'
  | 'EXPIRED'
  | 'INVALID_TOKEN'
  | 'NOT_IN_ROOM'
  | 'NOT_HOST'
  | 'NOT_READY'
  | 'PEER_MISSING'
  | 'SESSION_MISMATCH'
  | 'RATE_LIMITED'
  | 'INTERNAL';

export type CaptureAbortReason =
  | 'peer-left'
  | 'transfer-timeout'
  | 'host-retake'
  | 'room-expired'
  | 'camera-lost';

/** Participant view sent to clients. Never includes tokens or socket ids. */
export interface ParticipantState {
  role: Role;
  connected: boolean;
  cameraReady: boolean;
  dataChannelReady: boolean;
}

/** Authoritative room snapshot broadcast to both participants. */
export interface RoomState {
  code: string;
  status: RoomStatus;
  expiresAt: number;
  sessionId: string;
  currentShot: number;
  shotStatus: ShotStatus;
  completedShots: number[];
  shotsPerSession: number;
  host: ParticipantState | null;
  guest: ParticipantState | null;
}

/** Returned once to the joining tab. The token is private to that tab. */
export interface RoomMembership {
  code: string;
  role: Role;
  reconnectToken: string;
  expiresAt: number;
  state: RoomState;
}

export interface RoomError {
  code: RoomErrorCode;
  message: string;
}

export type Ack<T> =
  | { ok: true; data: T }
  | { ok: false; error: RoomError };

/** ICE configuration handed to the browser by the signaling service. */
export interface IceServerConfig {
  urls: string | string[];
  username?: string;
  credential?: string;
}

export interface IceConfigResponse {
  iceServers: IceServerConfig[];
  /** True when a relay is configured; useful for honest status messaging. */
  hasRelay: boolean;
}

/* -------------------------------------------------------------------------- */
/* Data channel messages (peer to peer only — never sent through signaling).   */
/* -------------------------------------------------------------------------- */

export interface StillBeginMessage {
  kind: 'still-begin';
  transferSeq: number;
  sessionId: string;
  shotNumber: number;
  role: Role;
  mimeType: string;
  byteSize: number;
  chunkCount: number;
  /** FNV-1a 32-bit hash, used only to detect corrupt/duplicated reassembly. */
  checksum: number;
}

export interface StillAckMessage {
  kind: 'still-ack';
  transferSeq: number;
  sessionId: string;
  shotNumber: number;
  ok: boolean;
}

export interface StillResetMessage {
  kind: 'still-reset';
  sessionId: string;
}

export type StillControlMessage =
  | StillBeginMessage
  | StillAckMessage
  | StillResetMessage;

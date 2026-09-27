# Bchu Misoo Photobooth — Database and State Design

**Status:** No database required for the functional MVP  
**Last updated:** 2026-09-27  
**See also:** [PRD.md](PRD.md) · [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

## 1. Decision

The MVP has no login, gallery, uploaded photo, or cross-restart session recovery. Use a **single in-memory room registry in the persistent signaling process**. The code, participant roles, readiness, and capture state are transient. Frames, previews, and final PNGs stay in each participant's browser memory. The server relays control/signaling only. A deployment with multiple signaling instances or a process restart needs a shared presence store and sticky/session routing, so do not deploy multiple instances with this design.

This document is called a database design because it specifies the present state model and an optional relational schema for a future opt-in gallery. **Do not create the SQL tables in the MVP.**

## 2. Current in-memory records

```ts
type Role = 'host' | 'guest';
type RoomStatus = 'waiting' | 'connecting' | 'ready' | 'capturing' | 'complete' | 'expired';

interface Participant {
  socketId: string | null;
  role: Role;
  reconnectTokenHash: string; // never store the raw token in the registry
  cameraReady: boolean;
  dataChannelReady: boolean;
  lastSeenAt: number; // epoch milliseconds
  disconnectedAt: number | null;
}

interface Room {
  code: string; // six uppercase human-enterable characters
  createdAt: number;
  expiresAt: number;
  status: RoomStatus;
  host: Participant;
  guest: Participant | null;
  sessionId: string; // random UUID, regenerated on Retake
  currentShot: number; // 0 before capture, then 1..4
  shotStatus: 'idle' | 'countdown' | 'transferring' | 'complete';
  completedShots: number[]; // shot numbers whose two stills were acknowledged
}

type RoomRegistry = Map<string, Room>; // normalized code -> room
```

Maintain a separate `socketId -> { code, role }` lookup or attach equivalent socket metadata for authorization. Never use the room code alone to authorize host-only operations. Do not store image buffers in these records or send them through Socket.IO.

### Lifecycle and invariants

1. **Create:** generate a code with cryptographic randomness; retry on collision; create host, `waiting` state, 30-minute absolute expiry, and a private reconnect token. Hash the token on the server; return the raw token only to that participant's tab and keep it in `sessionStorage`.
2. **Join:** normalize uppercase and trim whitespace; reject invalid code, expiry, or an occupied guest slot. Generate a guest token. Max two participants.
3. **Ready:** only mark ready when each client confirms a local camera and live peer data channel. `capturing` begins only after a host command accepted in `ready` state.
4. **Capture:** shot numbers 1–4 are sequential. Deduplicate commands by `(sessionId, shotNumber, eventId)`. The server tracks completion acknowledgments for each sender; each browser stores the actual image chunks locally. A Retake changes `sessionId` and resets shot progress on both browsers.
5. **Disconnect:** Socket.IO automatically removes a socket from its transport room, but the application retains participant role/state for a **60-second grace period**. A reconnect requires the matching room code and reconnect token; rebind the socket ID, then renegotiate WebRTC. Abort an in-flight shot and restart capture or retake with both present.
6. **Expire:** sweep rooms periodically, including empty rooms and those past `expiresAt`. Leave invalidates the leaving participant's token. Expiry/leave removes registry and socket lookup entries. A room code may eventually be reused only after the prior room expires; stale `sessionId` packets are ignored.

Use basic per-IP and per-socket limits for create/join attempts. Never print room codes together with tokens in logs. The explicit 30-minute TTL and 60-second grace are MVP defaults and can be adjusted after testing.

## 3. Realtime event contract

The server must validate all inputs at the boundary (for example with a shared schema library). `roomCode`, `sessionId`, and shot numbers are never enough to establish authorization; bind commands to the authenticated socket membership.

| Direction | Event | Minimal payload / rule |
| --- | --- | --- |
| Client → server | `room:create` | No payload; acknowledge `{code, role, reconnectToken, expiresAt}`. |
| Client → server | `room:join` | `{code}`; acknowledge membership or a typed `NOT_FOUND`, `FULL`, `EXPIRED` error. |
| Client → server | `room:resume` | `{code, reconnectToken}`; rotate token after success. |
| Client → server | `room:leave` | Membership inferred from socket; remove/broadcast status. |
| Client → server | `peer:signal` | `{type: 'offer'|'answer'|'ice', data}`; validate room membership, bound sizes, forward to other participant. |
| Client → server | `peer:ready` | `{cameraReady, dataChannelReady}`; server updates readiness. |
| Client → server | `capture:start` | Host only; server assigns fresh session ID (or uses current one) and sends `{sessionId, shotNumber: 1, startAt}`. |
| Client → server | `capture:ack` | `{sessionId, shotNumber, eventId, stage: 'local'|'peer-received'}`; validate sender, deduplicate and update progression. Image chunks never pass this event. |
| Client → server | `capture:retake` | Host only; reset state, issue new `sessionId`, notify both. |
| Server → client | `room:state`, `room:error`, `peer:signal`, `capture:countdown`, `capture:next`, `capture:abort` | Send authoritative role/status/shot changes and explicit errors. |

For capture synchronization, the server sends a start time far enough in the future for both clients to receive it (for example about three seconds). Clients estimate server clock offset with round trips, show countdown locally, then send local frames peer-to-peer. Account for latency; do not assert millisecond synchronization. Define exact event schemas in `packages/shared` before wiring handlers.

## 4. Client-side state

Each browser has its own `MediaStream`, `RTCPeerConnection`, data channel, and `Map<sessionId, Map<shotNumber, {host?: Blob, guest?: Blob}>>`. The role-specific still is captured locally at the end of the countdown; peer stills arrive in bounded chunks with transfer IDs and checksums. Only complete matched frames are displayed in the final Pair strip. On route exit, revoke temporary object URLs, close tracks/peer connection, and release photo buffers.

The final PNG is produced on demand in the browser. `sessionStorage` may contain only the room reconnect token and code; never put photo bytes or TURN secrets in browser storage. Closing/reloading a tab loses unsaved frames in the MVP.

## 5. Future optional persistence design

Introduce this only when the product explicitly adds **opt-in saved galleries**. Use PostgreSQL for metadata and private object storage for images. The schema assumes a separate authentication design; it does **not** assign identity to today's anonymous room-code users. Do not store base64 images in SQL.

```sql
-- Example migration for a future authenticated gallery, NOT an MVP migration.
CREATE TABLE app_user (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE saved_strip (
  id uuid PRIMARY KEY,
  owner_user_id uuid NOT NULL REFERENCES app_user(id) ON DELETE CASCADE,
  mode text NOT NULL CHECK (mode IN ('solo', 'pair')),
  object_key text NOT NULL UNIQUE,
  mime_type text NOT NULL CHECK (mime_type = 'image/png'),
  byte_size integer NOT NULL CHECK (byte_size > 0),
  width_px integer NOT NULL CHECK (width_px > 0),
  height_px integer NOT NULL CHECK (height_px > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz
);

CREATE INDEX saved_strip_owner_created_idx
  ON saved_strip (owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;
```

**Future rules:** require explicit user consent before upload; authorize reads/deletes by `owner_user_id`; keep object storage private; set a documented retention/deletion policy; delete the object when metadata is permanently deleted. Pair users saving the same composition should each consent and each receive their own owned record/object or an explicit shared ownership model. None of this schema makes room state or room codes permanent.

## 6. Scaling path

If the signaling service needs more than one process, move short-lived room/presence data to a shared TTL store such as Redis and use the corresponding Socket.IO multi-node adapter; validate sticky-session needs for the chosen transport/hosting setup. This is a later architecture change. A PostgreSQL gallery alone does not solve realtime room coordination.

# Bchu Misoo Photobooth — Product Requirements Document

**Product:** Bchu Misoo Photobooth (Multiplayer Photobooth by Bchu & Misoo)  
**Status:** Implementation specification for Cursor  
**Last updated:** 2026-09-27  
**Companion documents:** [DATABASE_DESIGN.md](DATABASE_DESIGN.md) · [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md)

## 1. Product summary

A browser photobooth for taking a four-frame photo strip alone or with one friend on another device. In Pair mode, both people see each other's live camera feeds, capture corresponding frames in one shared session, and can each download the completed strip. No account or upload is required.

The first implementation should be functional and visually plain. The later Figma design will supply typography, colors, spacing, and decoration. Do not invent a brand aesthetic now. Design on a **1440 px wide desktop Figma frame with flexible page height**; implement responsive CSS rather than a fixed 1440 px page.

## 2. Goals and release stages

| Stage | Required outcome | Release gate |
| --- | --- | --- |
| A — functional shell and Solo | Home, Solo, Pair lobby, Settings routes; camera preview, four-shot Solo sequence, strip preview, PNG download; Pair lobby may show a clear “Pair mode coming next” state until Stage B is done. | Solo end-to-end on a desktop and phone. |
| B — functional Pair MVP | Create/join a code, two live camera previews, coordinated four-shot capture, both participants receive the stills and can download an identical strip, disconnect/expiry handling. | Two devices on different networks complete a session. |
| Later | Figma visual integration, richer settings, optional saved gallery/accounts, visual effects. | Separate decisions and specifications. |

**The requested app is complete at Stage B.** Stage A is a build checkpoint, not a substitute for Pair mode. Do not present a nonfunctional second camera box as a finished Pair feature.

## 3. Users and core flows

1. **Solo:** Home → Solo → allow camera → optionally choose camera/mirroring → Take photos → four countdowns and captures → inspect strip → Download PNG → optionally Retake.
2. **Host in Pair:** Home → Pair → Create party → get short code and Copy code control → wait for friend → both camera previews connect → Take photos → four shared captures → inspect strip → Download PNG.
3. **Guest in Pair:** Home → Pair → enter code → Join → allow camera → wait for host/start → participate in four captures → Download PNG.

### Navigation and views

| Route | View | Required visible elements |
| --- | --- | --- |
| `/` | Home | “Bchu Misoo Photobooth” title; Solo, Pair, Settings buttons. |
| `/solo` | Solo photobooth | Solo title; top-left Back; camera settings on left, local live preview in center, strip preview on right; Take photos/Retake; Download PNG at bottom right. |
| `/pair` | Pair lobby | Pair title; top-left Back; Create party action on left; Join party label, code field, Join button on right. |
| `/pair/[roomCode]` | Pair photobooth | Pair title; top-left Back; room code/copy control and connection status; camera settings on left, local and remote live preview side by side in center, strip preview on right; host Take photos/Retake; Download PNG at bottom right. |
| `/settings` | Settings | Top-left Back; “In Progress” text. |

On narrow screens, stack settings, camera(s), strip, and actions in reading order. Do not clip camera or strip controls. Pair's two camera previews can become a vertical stack. Buttons and form fields must work by touch and keyboard.

## 4. Functional requirements

### 4.1 Camera and settings

- Request **video only** on first entering Solo or the Pair room; microphone permission is unnecessary. Show a helpful retry action if permission is denied, no camera exists, or the device is busy.
- Camera selector: show available video inputs after permission is granted and permit switching; fall back to the default camera when only one is available.
- Mirror toggle: mirror the user's preview and saved local frame consistently. The remote person's preview is not secretly re-mirrored on the receiving side.
- A live preview must not be mistaken for an already captured still. Stop local media tracks when leaving a photobooth room.
- Display camera labels and status in plain text; no filters, beauty effects, sound, flash, or camera access on Home/Settings in this release.

### 4.2 Capture and strip

- Default session: **four frames**, one frame after each **three-second visible countdown**. “Take photos” runs the whole sequence; never silently skip a frame.
- Solo frame is one camera image. Pair frame is a side-by-side composite with **host on the left and guest on the right for both users**, independent of who downloads it. The preview may put “You” first locally, but the exported strip uses host/guest order.
- Define one shared strip renderer: four same-size portrait frame slots in a vertical PNG, with consistent margins, aspect crop, and a plain neutral background. Use canvas `drawImage` with explicit cover crop; final PNG width 600 px and height derived from the chosen fixed layout. Keep layout constants in one file for Figma replacement later.
- Show empty placeholders before capture and fill slots as each shot completes. “Download PNG” is disabled until all four shots (and, in Pair, both halves of all four shots) exist.
- “Retake” clears the four previous frames for both participants after an explicit host action in Pair. Downloaded files remain on the user's device.
- Suggested filename: `bchu-misoo-solo-YYYYMMDD-HHMM.png` or `bchu-misoo-pair-YYYYMMDD-HHMM.png`, using the downloading device's time.

### 4.3 Rooms and realtime Pair behavior

- A Create party action issues a randomly generated, human-enterable **six-character uppercase alphanumeric code**, excluding ambiguous characters. The room supports exactly **one host and one guest**. Codes must be unpredictable enough for a short-lived casual session; rate-limit guesses/joins.
- Joining validates the code, rejects missing/expired/full rooms, and shows a specific error. Do not create an implicit new room on an invalid join.
- A waiting host sees the code and “Waiting for a friend.” Joining a room shows “Connecting”; both see the peer's live video or a clear camera/connection error state.
- Socket.IO carries room lifecycle and WebRTC signaling (offer, answer, ICE candidates) and capture control messages. WebRTC carries live camera video and the captured still images via a data channel. The signaling server must not receive image bytes or video tracks.
- Host starts the capture sequence only when both participants have a working local camera and data channel. Server validates that capture commands come from the room host. Both clients show the same shot number and countdown. Use an agreed future start time and clock-offset estimate; **do not promise exact frame-level synchronization** over the internet. A shot becomes complete only when both captured image payloads for that shot are received and acknowledged.
- Transfer each still as compressed JPEG over the data channel with bounded payload size and chunks no larger than 16 KiB; include room/session/shot ID, sender role, chunk index/count, and acknowledgment. Handle backpressure, missing chunks, duplication, timeout, and a transfer failure state. Render the final PNG locally on each device from the shared frames. Never log image data.
- If a peer disconnects, pause/abort the active sequence, keep already completed frames locally for the present session, show a reconnect/waiting state, and disable further capture/download until both halves of all four shots are present. Allow a short reconnect grace period to the same role using an opaque reconnect token held in that tab; afterward expire the room. No silent substitution of a new guest into a partly completed session.
- Room code and link are invitations, not authentication. Show who is connected as “Host”/“Guest,” and include a Leave action. Server enforces capacity and expires idle rooms; see [DATABASE_DESIGN.md](DATABASE_DESIGN.md).

### 4.4 Errors, privacy, and access

- Provide distinct messages for denied camera access, unsupported camera, invalid/full/expired room, connection failure, peer left, still-transfer failure, and unsupported browser. Preserve a safe route back Home.
- Deploy camera pages on HTTPS (localhost is acceptable for development). WebRTC should be configured with a STUN server and a TURN relay for real-world network reliability; credentials belong on the server or in short-lived credentials, never hard-coded in public source.
- No accounts, gallery uploads, facial analysis, microphone/audio capture, public room directory, analytics storing photos, or photos stored on the signaling server in the MVP. Images exist in browser memory until the user downloads them or leaves/reloads.
- Do not claim end-to-end privacy beyond what the implementation supports; TURN may relay encrypted WebRTC packets, and anyone with a valid room code may attempt to join an empty room.
- Use semantic headings, visible focus states, associated field labels, countdown text announced accessibly, and clear disabled button states. Do not depend solely on color for connection status.

## 5. Architecture and operating constraints

- Frontend: Next.js App Router, React, TypeScript, Tailwind CSS for minimal responsive layout.
- Realtime service: separate persistent Node.js + Socket.IO process, **not** an assumed long-lived Next.js serverless route. Use one process and an in-memory room map for the first release.
- Peer media: browser `getUserMedia`, `RTCPeerConnection`, RTCDataChannel; rendering/download: Canvas API.
- Hosting: frontend on an HTTPS web host; signaling on a WebSocket-capable persistent host with secure `wss://`. Configure allowed origins explicitly. Pair sessions are lost if the single in-memory process restarts; document this MVP limitation in release notes.
- Share event payload types and validation between web and server. Never trust client-supplied role, room membership, or session ID without server validation.

## 6. Acceptance criteria

- Home navigation and Back controls reach their expected routes. Settings displays “In Progress.”
- A desktop and a phone can grant camera access; if permission is refused, each receives an actionable error without an unusable blank preview.
- Solo captures exactly four countdown-driven stills, previews four slots, downloads a valid 600 px-wide PNG, and Retake starts a fresh sequence.
- Host creates a code; guest can join it from another device/network. A third participant is rejected. Wrong or expired codes explain the problem.
- Both Pair previews show their own and the other's live camera; only the host can start and retake. Each completed Pair frame contains one still from each participant in stable host-left order.
- Both devices can download visually identical four-frame compositions after all eight underlying stills arrive. A missing still prevents an incomplete download.
- Leaving, denied permission, interrupted connection, and server room expiry display a clear state and do not leave the local camera running after exit.
- Narrow phone screens can reach every control and preview without horizontal page scrolling.

## 7. Open product decisions for later design work

- Figma visual system, palette, type, decorative strip template, and branding.
- Whether to add alternate strip lengths, frame retakes, stickers, filters, audio, persistent photo galleries, or accounts.
- Exact countdown easing/animation and shutter sound (current release uses visible text only).

## References

- Camera permission and secure contexts: <https://developer.mozilla.org/en-US/docs/Web/API/MediaDevices/getUserMedia>
- WebRTC connection and signaling: <https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Connectivity> · <https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Signaling_and_video_calling>
- Data channel message limits: <https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Using_data_channels>
- Socket.IO rooms: <https://socket.io/docs/v4/rooms/>

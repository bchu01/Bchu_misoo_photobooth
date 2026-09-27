# Bchu Misoo Photobooth — Cursor Project Structure

**Target:** Next.js/React + TypeScript frontend; separate Node.js/Socket.IO signaling service; shared contracts  
**Last updated:** 2026-09-27  
**See also:** [PRD.md](PRD.md) · [DATABASE_DESIGN.md](DATABASE_DESIGN.md)

## 1. Proposed repository

```text
bchu-misoo-photobooth/
├── PRD.md
├── DATABASE_DESIGN.md
├── PROJECT_STRUCTURE.md
├── README.md
├── package.json                 # workspace scripts and package manager choice
├── .env.example                 # variable names and non-secret examples
├── apps/
│   ├── web/                     # Next.js App Router, TypeScript, Tailwind
│   │   ├── package.json
│   │   ├── next.config.ts
│   │   ├── src/
│   │   │   ├── app/
│   │   │   │   ├── page.tsx      # Home
│   │   │   │   ├── solo/page.tsx
│   │   │   │   ├── pair/page.tsx # Create / Join lobby
│   │   │   │   ├── pair/[roomCode]/page.tsx
│   │   │   │   ├── settings/page.tsx
│   │   │   │   ├── layout.tsx
│   │   │   │   └── globals.css
│   │   │   ├── components/
│   │   │   │   ├── CameraPreview.tsx
│   │   │   │   ├── CameraSettings.tsx
│   │   │   │   ├── PhotoStripPreview.tsx
│   │   │   │   ├── Countdown.tsx
│   │   │   │   ├── PairStatus.tsx
│   │   │   │   └── BackButton.tsx
│   │   │   ├── features/
│   │   │   │   ├── camera/useCamera.ts
│   │   │   │   ├── capture/captureFrame.ts
│   │   │   │   ├── capture/useCaptureSequence.ts
│   │   │   │   ├── strip/renderStrip.ts
│   │   │   │   ├── strip/downloadStrip.ts
│   │   │   │   ├── pair/usePairRoom.ts
│   │   │   │   ├── pair/usePeerConnection.ts
│   │   │   │   ├── pair/transferStill.ts
│   │   │   │   └── pair/clockSync.ts
│   │   │   └── lib/socketClient.ts
│   │   └── public/              # static assets when Figma design arrives
│   └── signaling/               # persistent Node.js process
│       ├── package.json
│       └── src/
│           ├── index.ts         # HTTP server, Socket.IO, origin policy
│           ├── rooms/registry.ts
│           ├── rooms/lifecycle.ts
│           ├── handlers/room.ts
│           ├── handlers/peer.ts
│           ├── handlers/capture.ts
│           └── middleware/rateLimit.ts
├── packages/
│   └── shared/
│       ├── package.json
│       └── src/
│           ├── events.ts        # typed client/server socket events
│           ├── schemas.ts       # runtime validation at network boundaries
│           ├── constants.ts     # room TTL, count, image transfer limits
│           └── types.ts
└── tests/
    ├── strip.test.ts            # 4-frame layout and host/guest ordering
    ├── rooms.test.ts            # create/join/full/expire/reconnect/auth
    └── pair-flow.spec.ts        # two browser contexts when Stage B works
```

Use workspace package names such as `@bchu/web`, `@bchu/signaling`, and `@bchu/shared`. Pick a package manager once and commit its lockfile. Route pages are thin composition layers; permission handling, capture, drawing, WebRTC, and room rules live in their respective modules. Browser APIs run inside client components/hooks only.

## 2. Responsibilities and data flow

| Module | Owns | Must avoid |
| --- | --- | --- |
| `apps/web` | Navigation, browser camera, both previews, client capture state, image transfer, canvas rendering, download. | Storing secrets or relying on server-side camera access. |
| `apps/signaling` | Code creation, two-person room capacity, reconnect and expiry, socket authorization, WebRTC signal forwarding, capture orchestration. | Receiving/storing image bytes or acting as video relay. |
| `packages/shared` | Event names, payload contracts and validation, status/role types, constants. | Importing browser or Node-only runtime APIs into shared code. |

Pair transport: each client obtains its own video track, opens one peer connection, exchanges SDP/ICE through signaling, then carries live video and bounded still chunks directly or through a configured TURN relay. Signaling decides room membership and authorized capture commands. Both browsers independently render the same ordered images into PNGs.

## 3. Environment and scripts

```dotenv
# apps/web (public configuration only)
NEXT_PUBLIC_SIGNALING_URL=http://localhost:3001

# apps/signaling (server-side configuration)
PORT=3001
WEB_ORIGIN=http://localhost:3000
TURN_URL=
TURN_USERNAME=
TURN_CREDENTIAL=
```

Use `NEXT_PUBLIC_` only for values safe to expose. Avoid putting long-lived TURN credentials in the web bundle; add a server endpoint for short-lived relay credentials before public deployment. Never commit a real `.env` file. Production URLs must use HTTPS and WSS. Development scripts should start web and signaling together; add `typecheck`, `lint`, and focused tests.

## 4. Build order for Cursor

1. Initialize the workspace and routes; create plain, responsive placeholders for all five views. Keep the `/pair/[roomCode]` page reachable only when a room is known to the app.
2. Implement `useCamera` with permissions, selector, mirror and cleanup. Build Solo capture sequence, four-slot strip, and PNG renderer. Verify a downloaded PNG.
3. Add shared runtime-validated Socket.IO events and an in-memory room registry; implement Create, Join, Full, Expired, Leave, and 60-second Resume behavior before video.
4. Implement peer negotiation and two live previews. Handle ICE/connection failure, teardown, reconnect, and TURN configuration.
5. Implement future-timestamp countdown commands, host-only actions, chunked still transfer with ack/backpressure/timeouts, and the eight-still completion gate. Both users should download the same host-left composition.
6. Verify with two real devices on different networks; handle mobile layout and permission failures. Then integrate supplied Figma code/style without moving room logic into presentational components.

Do not mark Stage B complete until the two-device acceptance criteria in [PRD.md](PRD.md) pass. Keep the Pair lobby honest during Stage A.

## 5. Test priorities

- **Unit:** strip frame dimensions/host-left order; room capacity, expiry, token rotation, unauthorized capture, duplicate shot acknowledgments.
- **Browser integration:** denied camera, cleanup on route exit, 4-shot Solo export, invalid code, disconnected peer, both Pair downloads after all image chunks arrive.
- **Manual device check:** different networks, mobile camera selection, narrow viewport, a network requiring TURN relay, and reconnect during countdown.

## 6. Scope boundaries

No ORM, SQL migration, cloud object storage, login, gallery, decorative theme, or image upload in MVP. Add database code only after a saved-gallery feature is approved and specified. The Figma frame establishes desktop composition; the actual app must reflow on phones.

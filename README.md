# Bchu Misoo Photobooth

A browser photobooth for taking a four-frame photo strip, alone or with one friend on another
device. In Pair mode both people see each other's live camera, capture matching frames in one shared
session, and each download an identical strip. No account, no upload.

This is the functional MVP described in [PRD.md](PRD.md). It is deliberately plain: the visual design
comes later from Figma. See [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) and
[DATABASE_DESIGN.md](DATABASE_DESIGN.md) for the architecture and state model.

## What works

- **Solo** — camera permission, camera picker, mirror toggle, four countdown-driven shots, live strip
  preview, PNG download.
- **Pair** — create or join a six-character room code, two live camera feeds over WebRTC, host-driven
  coordinated capture, still images transferred peer-to-peer over a data channel, and an identical
  PNG on both devices.
- **Settings** — placeholder, shows "In Progress".

## Requirements

- Node.js 20.9 or newer
- A browser with `getUserMedia` and WebRTC (recent Chrome, Edge, Firefox, or Safari)
- Camera pages need a secure context: `https://`, or `localhost` during development

## Getting started

```bash
npm install
cp .env.example apps/signaling/.env      # optional; defaults work for local development
npm run dev
```

`npm run dev` starts three things together: the shared package in watch mode, the signaling service
on port 3001, and the web app on port 3000. Open <http://localhost:3000>.

To try Pair mode properly, open the app on two devices (or two browser profiles) and have one create
a party and the other join with the code.

## Layout

```text
apps/web          Next.js App Router frontend: routes, camera, capture, strip rendering, WebRTC
apps/signaling    Persistent Node.js + Socket.IO service: rooms, signaling, capture orchestration
packages/shared   Event contracts, runtime validation schemas, protocol constants
tests             Unit tests for strip geometry and room rules, integration tests for the protocol
```

Route pages are thin composition layers. Camera access, capture, canvas drawing, room rules, and
peer transport each live in their own module under `apps/web/src/features`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Shared package watch + signaling + web, all together |
| `npm run build` | Builds shared, signaling, then web |
| `npm run typecheck` | Compiles every package with no emit |
| `npm run lint` | ESLint across the workspace |
| `npm test` | Vitest: strip layout, room rules, and socket protocol integration |
| `npm run start:signaling` / `npm run start:web` | Run the production builds |

## Configuration

All variable names and safe examples are in [.env.example](.env.example).

- `apps/web` reads only `NEXT_PUBLIC_SIGNALING_URL`. Nothing secret belongs in the web bundle.
- `apps/signaling` reads `PORT`, `WEB_ORIGIN` (an explicit allowlist of browser origins), `STUN_URLS`,
  and optional TURN settings.

TURN credentials stay on the server. The browser fetches ICE configuration from
`GET /ice-servers` at runtime. If you set `TURN_SECRET` (a coturn `static-auth-secret`), the service
mints short-lived HMAC credentials per request, which is the form to use before any public
deployment. Long-lived `TURN_USERNAME` / `TURN_CREDENTIAL` are supported but discouraged.

## How Pair mode works

1. The host creates a room; the server issues a random six-character code and a private reconnect
   token held only in that tab's `sessionStorage`.
2. The guest joins with the code. The room holds exactly two people and expires after 30 minutes.
3. Once both cameras are live, the host offers, the guest answers, and SDP/ICE flow through the
   signaling service. Live video and still images then travel directly between the browsers.
4. The host starts the sequence. The server schedules each shot at an agreed future timestamp; each
   client estimates its clock offset and counts down locally. This aligns the countdowns — it is not
   frame-level synchronization, and the app does not claim to be.
5. Each client captures its own frame, sends it as bounded JPEG chunks over the data channel, and
   acknowledges the frame it received. A shot completes only when both halves exist.
6. Both browsers render the same ordered frames locally. Pair frames are always host-left,
   guest-right, for both people, so the two downloads match.

## Privacy, honestly stated

- Photos exist only in browser memory. Nothing is uploaded, and the signaling service never receives
  image bytes or relays media.
- Reloading or leaving before you download loses unsaved frames.
- A room code is an invitation, not a password: anyone holding a valid code can try to take the empty
  second seat. Join attempts are rate limited.
- This is not end-to-end private beyond what WebRTC provides. On restrictive networks a TURN server
  relays the encrypted connection on your behalf.

## Known MVP limitations

- **Pair sessions do not survive a signaling restart.** Room state lives in one in-memory map, so do
  not run more than one instance of the signaling service against this design. Scaling out needs a
  shared TTL store such as Redis and the matching Socket.IO adapter.
- A disconnected participant has a 60-second grace period to resume with its token; after that the
  room expires. A new guest is never substituted into a partly finished session.
- No database, accounts, gallery, filters, stickers, or audio. Strip length is fixed at four frames.
- There is no automated two-browser end-to-end test yet. Stage B was verified manually with two
  browser contexts (both feeds live, four coordinated shots, byte-identical PNGs on both sides); the
  socket protocol itself is covered by `tests/signaling.test.ts`.

## Changing the look

Every pixel value and colour in the exported strip lives in
`apps/web/src/features/strip/stripLayout.ts`. Shared UI styling is concentrated in
`apps/web/src/components/ui/Button.tsx` and `apps/web/src/app/globals.css`. The Figma pass should be
able to restyle the product from those files without touching room or capture logic.

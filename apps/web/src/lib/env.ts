/**
 * Public browser configuration. Only `NEXT_PUBLIC_` values belong here, and none
 * of them is a secret: TURN credentials are fetched from the signaling service at
 * runtime instead of being compiled into the bundle.
 */

const DEFAULT_SIGNALING_URL = 'http://localhost:3001';

export const SIGNALING_URL = (
  process.env.NEXT_PUBLIC_SIGNALING_URL ?? DEFAULT_SIGNALING_URL
).replace(/\/$/, '');

export const ICE_SERVERS_URL = `${SIGNALING_URL}/ice-servers`;

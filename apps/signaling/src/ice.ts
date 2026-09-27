/**
 * ICE configuration served to the browser.
 *
 * TURN credentials stay on the server. When a coturn `static-auth-secret` is
 * configured the service mints short-lived HMAC credentials per request, which
 * is the form that should be used before any public deployment.
 */

import { createHmac } from 'node:crypto';
import type { IceConfigResponse, IceServerConfig } from '@bchu/shared';
import type { AppConfig } from './config.js';
import { logger } from './lib/logger.js';

/** coturn REST API: username is `<expiryUnixSeconds>`, password is its HMAC. */
function mintTurnCredentials(secret: string, ttlSeconds: number): { username: string; credential: string } {
  const username = String(Math.floor(Date.now() / 1000) + ttlSeconds);
  const credential = createHmac('sha1', secret).update(username).digest('base64');
  return { username, credential };
}

export function buildIceConfig(config: AppConfig): IceConfigResponse {
  const iceServers: IceServerConfig[] = [{ urls: config.stunUrls }];
  const { turn } = config;

  if (turn.urls.length > 0) {
    if (turn.secret) {
      const { username, credential } = mintTurnCredentials(turn.secret, turn.credentialTtlSeconds);
      iceServers.push({ urls: turn.urls, username, credential });
    } else if (turn.staticUsername && turn.staticCredential) {
      iceServers.push({
        urls: turn.urls,
        username: turn.staticUsername,
        credential: turn.staticCredential,
      });
    } else {
      logger.warn('TURN_URLS set without credentials; relay will be unavailable');
      return { iceServers, hasRelay: false };
    }
    return { iceServers, hasRelay: true };
  }

  return { iceServers, hasRelay: false };
}

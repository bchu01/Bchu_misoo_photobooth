/** Environment parsing. Fails loudly at boot rather than at first request. */

function readList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function readPort(value: string | undefined, fallback: number): number {
  if (!value) return fallback;
  const port = Number.parseInt(value, 10);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`PORT must be a valid port number, received "${value}".`);
  }
  return port;
}

export interface TurnConfig {
  urls: string[];
  /** coturn static-auth-secret used to mint short-lived credentials. */
  secret: string | null;
  credentialTtlSeconds: number;
  /** Long-lived fallback credentials. Discouraged; logged as a warning. */
  staticUsername: string | null;
  staticCredential: string | null;
}

export interface AppConfig {
  port: number;
  allowedOrigins: string[];
  stunUrls: string[];
  turn: TurnConfig;
  isProduction: boolean;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const allowedOrigins = readList(env.WEB_ORIGIN);
  if (allowedOrigins.length === 0) {
    allowedOrigins.push('http://localhost:3000');
  }

  const stunUrls = readList(env.STUN_URLS);
  if (stunUrls.length === 0) {
    stunUrls.push('stun:stun.l.google.com:19302');
  }

  return {
    port: readPort(env.PORT, 3001),
    allowedOrigins,
    stunUrls,
    turn: {
      urls: readList(env.TURN_URLS),
      secret: env.TURN_SECRET?.trim() || null,
      credentialTtlSeconds: Number.parseInt(env.TURN_CREDENTIAL_TTL_SECONDS ?? '3600', 10) || 3600,
      staticUsername: env.TURN_USERNAME?.trim() || null,
      staticCredential: env.TURN_CREDENTIAL?.trim() || null,
    },
    isProduction: env.NODE_ENV === 'production',
  };
}

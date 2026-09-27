/** Process entry point: load configuration, start the service, shut down cleanly. */

import { loadConfig } from './config.js';
import { buildIceConfig } from './ice.js';
import { logger } from './lib/logger.js';
import { createSignalingService } from './server.js';

const config = loadConfig();
const service = createSignalingService({ config });

const relayConfigured = buildIceConfig(config).hasRelay;

await service.listen(config.port);
logger.info('signaling service listening', {
  port: config.port,
  allowedOrigins: config.allowedOrigins,
  relayConfigured,
});

if (config.isProduction && !relayConfigured) {
  logger.warn('no TURN relay configured; peers on restrictive networks will fail to connect');
}

let shuttingDown = false;

function shutdown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;

  logger.info('shutting down', { signal });
  void service.close().then(() => process.exit(0));
  // Do not hang forever on a stuck socket.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

/**
 * Minimal structured logger.
 *
 * Deliberately narrow: this service must never log image bytes, reconnect
 * tokens, or TURN credentials. Room codes are logged only in redacted form so a
 * log leak cannot be replayed into a live session.
 */

type Level = 'info' | 'warn' | 'error';

function emit(level: Level, message: string, fields?: Record<string, unknown>): void {
  const line = { level, message, at: new Date().toISOString(), ...fields };
  const text = JSON.stringify(line);
  if (level === 'error') console.error(text);
  else if (level === 'warn') console.warn(text);
  else console.log(text);
}

/** Keeps codes correlatable across log lines without disclosing them. */
export function redactCode(code: string | null | undefined): string {
  if (!code) return 'none';
  return `${code.slice(0, 2)}****`;
}

export const logger = {
  info: (message: string, fields?: Record<string, unknown>) => emit('info', message, fields),
  warn: (message: string, fields?: Record<string, unknown>) => emit('warn', message, fields),
  error: (message: string, fields?: Record<string, unknown>) => emit('error', message, fields),
};

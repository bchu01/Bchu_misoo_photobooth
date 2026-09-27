/**
 * Plain-text status and error surface.
 *
 * Tone is carried by a text prefix as well as colour, so connection and error
 * states never depend on colour alone.
 */

export type StatusTone = 'info' | 'error' | 'success';

const TONE_STYLES: Record<StatusTone, string> = {
  info: 'border-zinc-300 bg-white text-zinc-800',
  error: 'border-red-400 bg-red-50 text-red-900',
  success: 'border-green-500 bg-green-50 text-green-900',
};

const TONE_PREFIX: Record<StatusTone, string> = {
  info: 'Status',
  error: 'Problem',
  success: 'Ready',
};

export interface StatusMessageProps {
  tone?: StatusTone;
  children: React.ReactNode;
  action?: React.ReactNode;
}

export function StatusMessage({ tone = 'info', children, action }: StatusMessageProps) {
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={`flex flex-col gap-3 rounded-md border p-4 text-sm sm:flex-row sm:items-center sm:justify-between ${TONE_STYLES[tone]}`}
    >
      <p>
        <span className="font-semibold">{TONE_PREFIX[tone]}:</span> {children}
      </p>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

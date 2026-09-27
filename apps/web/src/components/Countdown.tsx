/**
 * The visible pre-capture countdown.
 *
 * Announced politely to assistive technology so a screen reader user hears each
 * number, and shows "Smile!" on the capture beat rather than a bare zero.
 */
export function Countdown({ seconds }: { seconds: number }) {
  const label = seconds > 0 ? String(seconds) : 'Smile!';

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center bg-black/35">
      <p
        aria-live="assertive"
        aria-atomic="true"
        className="rounded-full bg-black/70 px-6 py-4 text-4xl font-bold tabular-nums text-white"
      >
        {label}
      </p>
    </div>
  );
}

/**
 * The round camera control at the bottom of the booth window.
 * It starts the sequence, or retakes once a strip already exists.
 */
export function ShutterButton({
  label,
  disabled,
  onClick,
}: {
  label: string;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className="grid size-[72px] shrink-0 place-items-center rounded-full border border-black bg-linear-to-br from-[#526fff] to-[#7dafff] disabled:cursor-not-allowed disabled:opacity-40 sm:size-[78px]"
    >
      <svg width="40" height="34" viewBox="0 0 52 43" fill="none" aria-hidden="true">
        <path
          d="M9.2 8.6h9.5c.3 0 .5 0 .6-.2.3-1.7 1.9-3.1 3.6-2.9.2 0 .4-.2.6-.6.8-2 2.7-3.3 4.9-3.5h8c2.2.2 4.1 1.5 4.9 3.5.2.4.4.6.6.6 1.7-.2 3.3 1.2 3.6 2.9.1.2.3.2.6.2h9.5c6.4 0 9.2 0 9.2 9.2v16c0 6.4-2.8 9.2-9.2 9.2H9.2C2.8 43 0 40.2 0 33.8V17.8C0 8.6 2.8 8.6 9.2 8.6Z"
          fill="white"
        />
        <circle cx="26" cy="25.8" r="8" stroke="#083CAC" strokeWidth="2" />
      </svg>
    </button>
  );
}

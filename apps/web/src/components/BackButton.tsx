import Link from 'next/link';

/**
 * Top-left escape hatch present on every view except Home. Always a real link so
 * a safe route back exists even when the page is in an error state.
 */
export function BackButton({ href = '/', label = 'Back' }: { href?: string; label?: string }) {
  return (
    <Link
      href={href}
      className="inline-flex min-h-11 items-center rounded-md border border-zinc-400 bg-white px-4 py-2 text-base font-medium text-zinc-900 hover:bg-zinc-100"
    >
      ← {label}
    </Link>
  );
}

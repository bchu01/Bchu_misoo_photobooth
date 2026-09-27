import Link from 'next/link';

/** Frosted bar shared by every screen: wordmark, About, Contact. */
export function SiteHeader() {
  return (
    <header className="mx-auto mt-4 flex w-[min(1329px,calc(100%-1.5rem))] items-center justify-between gap-4 rounded-[37px] border border-black bg-[rgba(243,243,243,0.74)] px-4 py-2 sm:mt-8 sm:px-8 sm:py-3">
      <Link
        href="/"
        className="text-sm tracking-[-0.05em] sm:text-2xl md:text-4xl"
      >
        BCHUMISOO PHOTO BOOTH
      </Link>
      <nav aria-label="Site" className="flex shrink-0 items-center gap-4 sm:gap-8">
        <Link href="/about" className="text-sm tracking-[-0.05em] sm:text-2xl md:text-4xl">
          About
        </Link>
        <Link href="/contact" className="text-sm tracking-[-0.05em] sm:text-2xl md:text-4xl">
          Contact
        </Link>
      </nav>
    </header>
  );
}

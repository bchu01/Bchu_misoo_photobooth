import Link from 'next/link';

const MENU = [
  { href: '/solo', label: 'SINGLE :(' },
  { href: '/pair', label: 'DUO :)' },
  { href: '/settings', label: 'SETTINGS' },
] as const;

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] w-full max-w-5xl flex-col items-center justify-center gap-12 px-4 py-16 text-center">
      <div className="flex flex-col gap-6 text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.25)]">
        <h1 className="text-3xl tracking-[-0.05em] sm:text-5xl">Welcome to BCHUMISOO’s world...</h1>
        <p className="text-2xl tracking-[-0.05em] sm:text-4xl">Click here to start exploring!</p>
      </div>

      <nav aria-label="Main menu" className="flex w-full max-w-[416px] flex-col gap-5">
        {MENU.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="grid h-[92px] place-items-center rounded-[37px] border border-black bg-[rgba(243,243,243,0.67)] text-3xl tracking-[-0.05em] sm:h-[106px] sm:text-5xl"
          >
            {item.label}
          </Link>
        ))}
      </nav>
    </main>
  );
}

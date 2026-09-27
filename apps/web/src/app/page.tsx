import Link from 'next/link';

const MENU = [
  { href: '/solo', label: 'Solo', description: 'Take a four-frame strip on this device.' },
  { href: '/pair', label: 'Pair', description: 'Take a strip with a friend on another device.' },
  { href: '/settings', label: 'Settings', description: 'Not built yet.' },
] as const;

export default function HomePage() {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-8 px-4 py-10 sm:px-6 lg:px-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-bold sm:text-4xl">Bchu Misoo Photobooth</h1>
        <p className="max-w-prose text-zinc-700">
          Four frames, three-second countdowns, and a PNG you can save. No account, and no photo ever
          leaves your browser unless you download it.
        </p>
      </header>

      <nav aria-label="Main menu">
        <ul className="flex max-w-md flex-col gap-3">
          {MENU.map((item) => (
            <li key={item.href}>
              <Link
                href={item.href}
                className="flex min-h-11 flex-col rounded-md border border-zinc-400 bg-white px-4 py-3 hover:bg-zinc-100"
              >
                <span className="text-lg font-medium">{item.label}</span>
                <span className="text-sm text-zinc-600">{item.description}</span>
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </div>
  );
}

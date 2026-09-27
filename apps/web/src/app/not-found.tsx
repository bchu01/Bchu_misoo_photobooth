import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] w-[min(720px,calc(100%-1.5rem))] items-center justify-center py-16">
      <section className="rounded-[37px] border border-black bg-[rgba(243,243,243,0.74)] p-8 text-center sm:p-12">
        <h1 className="text-3xl tracking-[-0.05em] sm:text-5xl">Page not found</h1>
        <p className="mt-6 text-lg tracking-[-0.05em] sm:text-2xl">That address is not part of the booth.</p>
        <Link href="/" className="mt-8 inline-block text-lg underline tracking-[-0.05em] sm:text-2xl">
          Back home
        </Link>
      </section>
    </main>
  );
}

export default function AboutPage() {
  return (
    <main className="mx-auto flex min-h-[calc(100dvh-8rem)] w-[min(720px,calc(100%-1.5rem))] items-center justify-center py-16">
      <section className="rounded-[37px] border border-black bg-[rgba(243,243,243,0.74)] p-8 text-center sm:p-12">
        <h1 className="text-3xl tracking-[-0.05em] sm:text-5xl">About</h1>
        <p className="mt-6 text-lg tracking-[-0.05em] sm:text-2xl">
          BCHUMISOO Photo Booth takes a four-frame strip in your browser, alone or with one friend
          on another device. Photos stay on your device until you download them.
        </p>
      </section>
    </main>
  );
}

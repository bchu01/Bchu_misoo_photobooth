/**
 * The photobooth "window": traffic-light chrome, a grey stage, and a control
 * shelf. Solo, Duo, and Connect all sit in this frame.
 */
export function BoothWindow({
  children,
  footer,
}: {
  children: React.ReactNode;
  footer?: React.ReactNode;
}) {
  return (
    <section className="mx-auto w-[min(988px,calc(100%-1.5rem))] overflow-hidden rounded-[28px] border border-black bg-[rgba(243,243,243,0.74)] sm:rounded-[37px]">
      <div className="relative flex items-center gap-3 border-b border-black px-4 py-3">
        <span className="flex items-center gap-2" aria-hidden="true">
          <span className="size-[22px] rounded-full border border-black bg-[#e06363]" />
          <span className="size-[22px] rounded-full border border-black bg-[#e4c954]" />
          <span className="size-[22px] rounded-full border border-black bg-[#67c75c]" />
        </span>
        <p className="pointer-events-none absolute inset-x-16 text-center text-sm tracking-[-0.05em] sm:text-xl">
          BCHUMISOO PHOTO BOOTH
        </p>
      </div>
      <div className="border-b border-black bg-[#d9d9d9]">{children}</div>
      {footer ? <div className="px-4 py-4 sm:px-6 sm:py-5">{footer}</div> : null}
    </section>
  );
}

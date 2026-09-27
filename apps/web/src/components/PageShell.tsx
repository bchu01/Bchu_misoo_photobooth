import { BackButton } from './BackButton';

/**
 * Common page frame: a top-left Back control, a single page heading, and a
 * content column that reflows instead of clipping on narrow screens.
 */
export interface PageShellProps {
  title: string;
  backHref?: string | null;
  headerAside?: React.ReactNode;
  children: React.ReactNode;
}

export function PageShell({ title, backHref = '/', headerAside, children }: PageShellProps) {
  return (
    <div className="mx-auto flex w-full max-w-[1440px] flex-col gap-6 px-4 py-6 sm:px-6 lg:px-10">
      <header className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          {backHref ? <BackButton href={backHref} /> : <span />}
          {headerAside}
        </div>
        <h1 className="text-2xl font-bold sm:text-3xl">{title}</h1>
      </header>
      <main className="flex flex-col gap-6">{children}</main>
    </div>
  );
}

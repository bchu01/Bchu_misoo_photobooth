import type { ButtonHTMLAttributes } from 'react';

/**
 * The only button in the app. Keeping every variant here means the Figma pass
 * restyles the whole product from one file without touching behaviour.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-4 py-2 text-base font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'border-zinc-900 bg-zinc-900 text-white enabled:hover:bg-zinc-700',
  secondary: 'border-zinc-400 bg-white text-zinc-900 enabled:hover:bg-zinc-100',
  quiet: 'border-transparent bg-transparent text-zinc-700 underline enabled:hover:text-zinc-900',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`.trim()} {...rest} />;
}

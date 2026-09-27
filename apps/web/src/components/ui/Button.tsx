import type { ButtonHTMLAttributes } from 'react';

/**
 * The only button in the app. Keeping every variant here means the Figma pass
 * restyles the whole product from one file without touching behaviour.
 */
export type ButtonVariant = 'primary' | 'secondary' | 'quiet';

const BASE =
  'inline-flex min-h-11 items-center justify-center gap-2 rounded-[21px] border border-black px-4 py-2 text-base tracking-[-0.05em] disabled:cursor-not-allowed disabled:opacity-40';

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-linear-to-r from-[#efefef] to-[#b6b6b6] text-black',
  secondary: 'bg-white text-black',
  quiet: 'border-transparent bg-transparent text-black underline',
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
}

export function Button({ variant = 'secondary', className = '', type = 'button', ...rest }: ButtonProps) {
  return <button type={type} className={`${BASE} ${VARIANTS[variant]} ${className}`.trim()} {...rest} />;
}

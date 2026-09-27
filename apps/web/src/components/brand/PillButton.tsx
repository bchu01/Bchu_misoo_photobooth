import type { ButtonHTMLAttributes } from 'react';

/** Grey gradient pill used for Create, Join, and Download in the Figma frames. */
export function PillButton({
  className = '',
  type = 'button',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement>) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-[53px] items-center justify-center rounded-[21px] border border-black bg-linear-to-r from-[#efefef] to-[#b6b6b6] px-6 text-lg tracking-[-0.05em] disabled:cursor-not-allowed disabled:opacity-40 sm:text-2xl ${className}`}
      {...rest}
    />
  );
}

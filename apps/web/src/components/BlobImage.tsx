'use client';

import { useEffect, useRef } from 'react';

/**
 * Renders an in-memory image blob and revokes its object URL as soon as the blob
 * changes or the component unmounts.
 *
 * Captured frames only ever exist in memory, so the URL lifetime is tied to the
 * element that uses it rather than held in component state.
 */
export interface BlobImageProps {
  blob: Blob | null | undefined;
  alt: string;
  className?: string;
}

export function BlobImage({ blob, alt, className }: BlobImageProps) {
  const ref = useRef<HTMLImageElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !blob) return;

    const url = URL.createObjectURL(blob);
    element.src = url;

    return () => {
      element.removeAttribute('src');
      URL.revokeObjectURL(url);
    };
  }, [blob]);

  return <img ref={ref} alt={alt} className={className} />;
}

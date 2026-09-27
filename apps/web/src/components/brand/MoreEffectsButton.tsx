'use client';

import { useState } from 'react';

/**
 * Present in the Figma shelf. Effects are not part of this release, so the
 * control explains that instead of pretending to apply one.
 */
export function MoreEffectsButton() {
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        className="h-[29px] rounded-[10px] border border-black bg-linear-to-r from-[#efefef] to-[#b6b6b6] px-3 text-sm tracking-[-0.05em]"
      >
        More Effects...
      </button>
      {open ? (
        <p
          role="status"
          className="absolute right-0 bottom-10 z-10 w-56 rounded-2xl border border-black bg-white p-3 text-left text-sm tracking-[-0.05em]"
        >
          Effects are not in this version yet.
        </p>
      ) : null}
    </div>
  );
}

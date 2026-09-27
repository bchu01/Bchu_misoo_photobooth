import Link from 'next/link';

/** Solo / Duo switch in the booth shelf. The active mode is drawn in blue. */
export function ModeSwitch({ active }: { active: 'solo' | 'duo' }) {
  const solo = active === 'solo';

  return (
    <div className="flex h-[51px] items-center gap-3 rounded-full border border-black bg-linear-to-r from-[#939393] to-[#efefef] px-4">
      <Link
        href="/solo"
        aria-label="Solo"
        aria-current={solo ? 'page' : undefined}
        className="grid size-8 place-items-center"
      >
        <PersonIcon stroke={solo ? '#2732D0' : '#000000'} />
      </Link>
      <Link
        href="/pair"
        aria-label="Duo"
        aria-current={solo ? undefined : 'page'}
        className="grid size-8 place-items-center"
      >
        <PeopleIcon stroke={solo ? '#000000' : '#0D48C8'} />
      </Link>
    </div>
  );
}

function PersonIcon({ stroke }: { stroke: string }) {
  return (
    <svg width="22" height="26" viewBox="0 0 25 32" fill="none" aria-hidden="true">
      <path
        d="M24 31c0-6.4-5.2-11.6-11.5-11.6S1 24.6 1 31M12.5 14.2a7.1 7.1 0 1 0 0-14.2 7.1 7.1 0 0 0 0 14.2Z"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PeopleIcon({ stroke }: { stroke: string }) {
  return (
    <svg width="30" height="24" viewBox="0 0 36 30" fill="none" aria-hidden="true">
      <path
        d="M28 29c0-3.3-4.5-6-10-6s-10 2.7-10 6M35 23.5C35 21.2 32.5 19.2 29 18.3M1 23.5C1 21.2 3.5 19.2 7 18.3M29 10.2A6 6 0 1 0 22 1.6M7 10.2A6 6 0 1 1 14 1.6M18 18a6 6 0 1 0 0-12 6 6 0 0 0 0 12Z"
        stroke={stroke}
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

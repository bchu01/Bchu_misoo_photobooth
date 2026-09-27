/**
 * The blurred colour field behind every screen. Positions follow the Figma
 * circles; blur replaces the exported SVG filter so it stays cheap to paint.
 */
const BLOBS = [
  { color: '#0D48C8', className: 'top-[55%] left-[8%] size-[28rem]' },
  { color: '#B21919', className: 'top-[18%] left-[28%] size-[26rem]' },
  { color: '#37FFE8', className: 'top-[48%] left-[32%] size-[28rem]' },
  { color: '#FF4B4B', className: 'top-[2%] right-[0%] size-[28rem]' },
  { color: '#00553C', className: 'top-[22%] left-[-8%] size-[28rem]' },
  { color: '#00A179', className: 'top-[-6%] left-[18%] size-[28rem]' },
  { color: '#CEFF2D', className: 'top-[28%] right-[-6%] size-[28rem]' },
  { color: '#FFB0B0', className: 'top-[52%] right-[-4%] size-[28rem]' },
] as const;

export function GradientField() {
  return (
    <div className="pointer-events-none fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {BLOBS.map((blob) => (
        <span
          key={blob.color + blob.className}
          className={`absolute rounded-full blur-[90px] sm:blur-[120px] ${blob.className}`}
          style={{ backgroundColor: blob.color }}
        />
      ))}
    </div>
  );
}

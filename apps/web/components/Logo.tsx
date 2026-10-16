/* The Saga OS mark: Saga, the house mascot. Same family and colours as the helpers (the Chief of Staff's indigo,
   dot eyes, rosy cheeks) with a warm spark on top: the one who keeps the company going. */

export const SAGA_BODY = "#6366f1";   // the Chief's indigo
export const SAGA_TILE = "#e0e7ff";   // indigo-100
export const SAGA_SPARK = "#f59e0b";
export const SAGA_INK = "#1c1917";

export function SagaMascot({ size = 24, tile = true, title = "Saga OS" }: { size?: number; tile?: boolean; title?: string }) {
  return (
    <svg className="saga-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs>
        <clipPath id="saga-tile"><rect width="64" height="64" rx="18" /></clipPath>
        <linearGradient id="saga-body" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stopColor="#7c7ff5" /><stop offset="1" stopColor={SAGA_BODY} /></linearGradient>
      </defs>
      <g clipPath={tile ? "url(#saga-tile)" : undefined}>
        {tile && <rect width="64" height="64" fill={SAGA_TILE} />}
        {/* body */}
        <path d="M9 72 C9 36 18 20 32 20 C46 20 55 36 55 72 Z" fill="url(#saga-body)" />
        <path d="M18 34 C20 27 25 23 30 22" stroke="#fff" strokeOpacity=".35" strokeWidth="2.6" strokeLinecap="round" fill="none" />
        {/* eyes */}
        <circle cx="25" cy="38" r="3.8" fill={SAGA_INK} /><circle cx="39" cy="38" r="3.8" fill={SAGA_INK} />
        <circle cx="26.3" cy="36.7" r="1.3" fill="#fff" /><circle cx="40.3" cy="36.7" r="1.3" fill="#fff" />
        {/* smile and cheeks */}
        <path d="M27.5 46 Q32 50.5 36.5 46" stroke={SAGA_INK} strokeWidth="2.4" strokeLinecap="round" fill="none" />
        <circle cx="19.5" cy="45" r="3" fill="#fb7185" opacity=".65" /><circle cx="44.5" cy="45" r="3" fill="#fb7185" opacity=".65" />
        {/* the spark */}
        <path d="M32 3.5 C33 9.5 34.5 11 40.5 12 C34.5 13 33 14.5 32 20.5 C31 14.5 29.5 13 23.5 12 C29.5 11 31 9.5 32 3.5 Z" fill={SAGA_SPARK} stroke={SAGA_INK} strokeWidth="1.4" strokeLinejoin="round" />
        <circle cx="45" cy="7" r="1.6" fill={SAGA_SPARK} />
      </g>
    </svg>
  );
}

/** The mark next to the product or company name. */
export function Mark({ size = 24 }: { size?: number }) {
  return <span className="mark" aria-hidden><SagaMascot size={size} /></span>;
}

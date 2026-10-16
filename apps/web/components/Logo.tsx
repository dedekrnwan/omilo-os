/* The Saga OS mark: Saga, the house mascot. Same family as the helpers (round body, dot eyes, rosy cheeks),
   but dark ink with a warm spark on top: the one who keeps the company going. */

export const SAGA_INK = "#1c1917";
export const SAGA_SPARK = "#f59e0b";

export function SagaMascot({ size = 24, tile = true, title = "Saga OS" }: { size?: number; tile?: boolean; title?: string }) {
  return (
    <svg className="saga-mark" width={size} height={size} viewBox="0 0 64 64" role="img" aria-label={title}>
      <defs><clipPath id="saga-tile"><rect width="64" height="64" rx="18" /></clipPath></defs>
      <g clipPath={tile ? "url(#saga-tile)" : undefined}>
        {tile && <rect width="64" height="64" fill="#f5f5f4" />}
        {/* body */}
        <path d="M9 72 C9 36 18 20 32 20 C46 20 55 36 55 72 Z" fill={SAGA_INK} />
        {/* eyes */}
        <circle cx="25" cy="38" r="4.6" fill="#fff" /><circle cx="39" cy="38" r="4.6" fill="#fff" />
        <circle cx="25.8" cy="38.6" r="2.4" fill={SAGA_INK} /><circle cx="39.8" cy="38.6" r="2.4" fill={SAGA_INK} />
        <circle cx="26.6" cy="37.6" r=".9" fill="#fff" /><circle cx="40.6" cy="37.6" r=".9" fill="#fff" />
        {/* smile and cheeks */}
        <path d="M27.5 47 Q32 51.5 36.5 47" stroke="#fff" strokeWidth="2.4" strokeLinecap="round" fill="none" />
        <circle cx="19.5" cy="46" r="3" fill="#fb7185" opacity=".8" /><circle cx="44.5" cy="46" r="3" fill="#fb7185" opacity=".8" />
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

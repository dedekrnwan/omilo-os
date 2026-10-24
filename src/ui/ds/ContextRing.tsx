/**
 * pen `Context Ring` (iWcry): donut (inner radius 70%) — track line-strong,
 * arc ink-2 sweeping clockwise from 12 o'clock.
 */
export function ContextRing({ size = 16, value }: { size?: number; value: number }) {
  const outer = size / 2
  const width = outer * 0.3
  const r = outer - width / 2
  const c = 2 * Math.PI * r
  const pct = Math.max(0, Math.min(100, value)) / 100
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden className="shrink-0">
      <circle cx={outer} cy={outer} r={r} fill="none" stroke="var(--color-line-strong)" strokeWidth={width} />
      <circle
        cx={outer}
        cy={outer}
        r={r}
        fill="none"
        stroke="var(--color-ink-2)"
        strokeWidth={width}
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${outer} ${outer})`}
      />
    </svg>
  )
}

/**
 * Local variant of pen `Context Ring` (iWcry) that also takes the arc colour and
 * the inner radius (the context menu uses 0.78, the composer 0.7; the "almost
 * full" state draws the arc in `bad`). Track line-strong; arc sweeps clockwise
 * from 12 o'clock.
 */
export function Ring({
  size = 16,
  value,
  color = 'var(--color-ink-2)',
  inner = 0.7,
}: {
  size?: number
  value: number
  color?: string
  inner?: number
}) {
  const outer = size / 2
  const width = outer * (1 - inner)
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
        stroke={color}
        strokeWidth={width}
        strokeDasharray={`${c * pct} ${c}`}
        transform={`rotate(-90 ${outer} ${outer})`}
      />
    </svg>
  )
}

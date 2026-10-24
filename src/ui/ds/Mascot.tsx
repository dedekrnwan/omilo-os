import type { HelperArea } from '../../core/domain/types'
import { helperColor } from '../tokens'

// Geometry of the pen.dev "Mascot" component (64×64 artboard).
const BODY = 'M10 70c0-36 9-54 22-54 13 0 22 18 22 54z'
const CHEEKS = 'M17.9 41a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z m23 0a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z'
const EYES = 'M21.4 34a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z m14 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z'
const SHINE = 'M25 32.8a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z m14 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z'
const MOUTH = 'M27.5 42.5q4.5 4.5 9 0'

export interface MascotProps {
  /** Rendered width/height in px */
  size: number
  /** Corner radius in px. Defaults to the component's 18/64 ratio. */
  radius?: number
  /** Helper whose colour the body takes. Chief = brand. */
  area?: HelperArea
  /** Tinted tile behind the body (pen default). Set false for a bare mascot. */
  tile?: boolean
  className?: string
  title?: string
}

/** Omilo helper mascot — the blob with eyes used for Chief and every agent. */
export function Mascot({ size, radius, area = 'brand', tile = true, className = '', title }: MascotProps) {
  const color = helperColor[area]
  const r = radius ?? (size * 18) / 64
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      className={`relative inline-block shrink-0 overflow-hidden ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: tile ? `linear-gradient(${color}29, ${color}29), #FFFFFF` : undefined,
      }}
    >
      <svg viewBox="0 0 64 64" width={size} height={size} className="absolute inset-0 overflow-visible">
        <path d={BODY} fill={color} />
        <path d={CHEEKS} fill="#FFFFFF4D" />
        <path d={EYES} fill="var(--color-mascot-ink)" />
        <path d={SHINE} fill="#FFFFFF" />
        <path
          d={MOUTH}
          fill="none"
          stroke="var(--color-mascot-ink)"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  )
}

import { useEffect, useId, useRef } from 'react'
import type { HelperArea } from '../../core/domain/types'
import { helperColor } from '../tokens'
import { playMascot } from './mascotSound'

// Geometry of the pen.dev "Mascot" component (64×64 artboard).
const BODY = 'M10 70c0-36 9-54 22-54 13 0 22 18 22 54z'
const CHEEKS = 'M17.9 41a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z m23 0a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z'
const EYES = 'M21.4 34a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z m14 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z'
const SHINE = 'M25 32.8a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z m14 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z'
const MOUTH = 'M27.5 42.5q4.5 4.5 9 0'
/** Open smile shown on hover (from omilo-os). */
const MOUTH_HAPPY = 'M27 42 Q32 50 37 42 Z'

/** Each helper's voice "prop" (omilo-os sound tunes) — the v2 mascots don't draw props. */
const VOICE: Record<HelperArea, string> = {
  brand: 'crown',
  dev: 'glasses',
  ops: 'gear',
  support: 'headset',
  finance: 'coin',
  marketing: 'megaphone',
  sales: 'tie',
  retro: 'magnifier',
}

// ── Life: eyes follow the cursor, hop + voice on click (shared across mascots) ─

const alive = new Set<SVGSVGElement>()
let listening = false
let frame = 0
let px = -1e4
let py = -1e4

const reducedMotion = () =>
  typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

/** Moves each visible mascot's face a few units toward the cursor, only when the cursor is near. */
function track() {
  frame = 0
  for (const el of alive) {
    const r = el.getBoundingClientRect()
    if (!r.width || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
    const dx = px - (r.left + r.width / 2)
    const dy = py - (r.top + r.height / 2)
    const d = Math.hypot(dx, dy)
    const reach = Math.max(220, r.width * 5)
    const k =
      d > reach || d < 1
        ? 0
        : Math.min(1, d / (r.width * 0.9 + 1)) * (1 - Math.max(0, d - reach * 0.6) / (reach * 0.4))
    const ex = d ? (dx / d) * 4 * k : 0
    const ey = d ? (dy / d) * 3 * k : 0
    const next = `${ex.toFixed(1)},${ey.toFixed(1)}`
    if (el.dataset.look !== next) {
      el.dataset.look = next
      el.style.setProperty('--ex', `${ex.toFixed(2)}px`)
      el.style.setProperty('--ey', `${ey.toFixed(2)}px`)
    }
  }
}

function listen() {
  if (listening || typeof window === 'undefined') return
  listening = true
  if (reducedMotion()) return
  const schedule = () => {
    if (!frame) frame = requestAnimationFrame(track)
  }
  window.addEventListener(
    'pointermove',
    (e) => {
      px = e.clientX
      py = e.clientY
      schedule()
    },
    { passive: true },
  )
  window.addEventListener('scroll', schedule, { passive: true, capture: true })
  document.addEventListener('pointerleave', () => {
    px = py = -1e4
    schedule()
  })
}

let clicking = false
/** A click on any mascot makes it hop and say something in its own voice. */
function listenClicks() {
  if (clicking || typeof document === 'undefined') return
  clicking = true
  document.addEventListener(
    'pointerdown',
    (e) => {
      if (e.button !== 0) return
      const el = (e.target as Element | null)?.closest?.('.mascot') as HTMLElement | null
      if (!el) return
      playMascot({ shape: 'blob', prop: el.dataset.prop, color: el.dataset.color })
      if (reducedMotion()) return
      el.classList.remove('hop')
      void el.getBoundingClientRect()
      el.classList.add('hop')
      setTimeout(() => el.classList.remove('hop'), 520)
    },
    { passive: true },
  )
}

export interface MascotProps {
  /** Rendered width/height in px */
  size: number
  /** Corner radius in px. Defaults to the component's 18/64 ratio. */
  radius?: number
  /** Helper whose colour the body takes. Chief = brand. */
  area?: HelperArea
  /** Tinted tile behind the body (pen default). Set false for a bare mascot. */
  tile?: boolean
  /** Freeze: no blinking, no cursor-tracking (hover/hop still work). */
  still?: boolean
  /** Working: a gentle bob while the helper is busy. */
  working?: boolean
  className?: string
  title?: string
}

/**
 * Omilo helper mascot — the blob with eyes used for Chief and every agent.
 * Alive like in omilo-os: blinks (each at its own moment), eyes follow the
 * cursor, lifts and smiles on hover, hops and chirps on click. Reduced-motion
 * users get a still mascot.
 */
export function Mascot({
  size,
  radius,
  area = 'brand',
  tile = true,
  still = false,
  working = false,
  className = '',
  title,
}: MascotProps) {
  const color = helperColor[area]
  const r = radius ?? (size * 18) / 64
  const ref = useRef<SVGSVGElement>(null)
  const uid = useId()

  useEffect(() => {
    listenClicks()
  }, [])
  useEffect(() => {
    const el = ref.current
    if (!el || still) return
    listen()
    alive.add(el)
    return () => {
      alive.delete(el)
    }
  }, [still])

  // Blink at a different moment for each mascot
  let h = 0
  for (const c of uid) h = (h * 31 + c.charCodeAt(0)) % 997
  const tiny = size < 22

  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      data-prop={VOICE[area]}
      data-color={color}
      className={`mascot relative inline-block shrink-0 overflow-hidden ${still || tiny ? 'still' : ''} ${
        working ? 'working' : ''
      } ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: tile ? `linear-gradient(${color}29, ${color}29), #FFFFFF` : undefined,
      }}
    >
      <svg
        ref={ref}
        viewBox="0 0 64 64"
        width={size}
        height={size}
        className="absolute inset-0 overflow-visible"
        style={{ ['--blink' as string]: `${(h % 40) / 10}s` }}
      >
        <g className="m-char">
          <path d={BODY} fill={color} />
          <g className="m-face">
            <path className="m-cheek" d={CHEEKS} fill="#FFFFFF4D" />
            <g className="m-eyes">
              <path d={EYES} fill="var(--color-mascot-ink)" />
              <path d={SHINE} fill="#FFFFFF" />
            </g>
            <path
              className="m-mouth"
              d={MOUTH}
              fill="none"
              stroke="var(--color-mascot-ink)"
              strokeWidth={2.2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              className="m-mouth-happy"
              d={MOUTH_HAPPY}
              fill="var(--color-mascot-ink)"
              stroke="var(--color-mascot-ink)"
              strokeWidth={1.6}
              strokeLinejoin="round"
            />
          </g>
        </g>
      </svg>
    </span>
  )
}

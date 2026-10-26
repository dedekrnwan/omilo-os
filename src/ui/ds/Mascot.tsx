import { useEffect, useId, useRef } from 'react'
import type { HelperArea } from '../../core/domain/types'
import { useMascotLook } from '../../app/mascotLook'
import { helperColor } from '../tokens'
import { playMascot } from './mascotSound'

// ── Geometry: pen.dev `Mascot` design-system component (mBgDG, 64×64) ─────────

export type MascotShape = 'blob' | 'box' | 'bean'
export type MascotProp =
  | 'none'
  | 'crown'
  | 'glasses'
  | 'gear'
  | 'headset'
  | 'coin'
  | 'megaphone'
  | 'tie'
  | 'magnifier'
  | 'spark'
export type MascotMood = 'happy' | 'worried' | 'sad'

const BODY: Record<MascotShape, string> = {
  blob: 'M10 70c0-36 9-54 22-54 13 0 22 18 22 54z',
  box: 'M26 17h12a13 13 0 0 1 13 13v26a13 13 0 0 1-13 13h-12a13 13 0 0 1-13-13v-26a13 13 0 0 1 13-13z',
  bean: 'M12 44a20 27 0 1 0 40 0 20 27 0 1 0-40 0z',
}
const CHEEKS = 'M17.9 41a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z m23 0a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z'
const EYES = 'M21.4 34a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z m14 0a3.6 3.6 0 1 0 7.2 0 3.6 3.6 0 1 0-7.2 0z'
const SHINE = 'M25 32.8a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z m14 0a1.2 1.2 0 1 0 2.4 0 1.2 1.2 0 1 0-2.4 0z'
const MOUTH = 'M27.5 42.5q4.5 4.5 9 0'
const MOUTH_HAPPY = 'M27 42q5 8 10 0z'
const MOUTH_WORRIED = 'M29.4 44.5a2.6 3 0 1 0 5.2 0 2.6 3 0 1 0-5.2 0z'
const MOUTH_SAD = 'M27.5 46.5q4.5-5 9 0'
const BROWS_WORRIED = 'M21 27.5q3.5-2 7-0.5m15 0.5q-3.5-2-7-0.5'
const BROWS_SAD = 'M20.5 29.5l7.5-2m15.5 2l-7.5-2'
const TEAR = 'M41.5 38.5c-1.5 3-1.5 5 0 5.5 1.5-0.5 1.5-2.5 0-5.5z'

const INK = 'var(--color-mascot-ink)'
const stroke = (w: number) => ({
  stroke: INK,
  strokeWidth: w,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
})

function Prop({ prop }: { prop: MascotProp }) {
  switch (prop) {
    case 'crown':
      return <path d="M21 19l2.5-10.5 5 5.5 3.5-7 3.5 7 5-5.5 2.5 10.5z" fill="#FACC15" {...stroke(1.6)} />
    case 'glasses':
      return (
        <path
          d="M19 34a6 6 0 1 0 12 0 6 6 0 1 0-12 0z m14 0a6 6 0 1 0 12 0 6 6 0 1 0-12 0z m-2 0h2"
          fill="#FFFFFF40"
          {...stroke(2)}
        />
      )
    case 'gear':
      return (
        <>
          <path
            d="M48 43h4l1 3 3-1.5 2.6 2.6-1.5 3 3 1v4l-3 1 1.5 3-2.6 2.6-3-1.5-1 3h-4l-1-3-3 1.5-2.6-2.6 1.5-3-3-1v-4l3-1-1.5-3 2.6-2.6 3 1.5z"
            fill="#E7E5E4"
            {...stroke(1.4)}
          />
          <path d="M47.4 52a2.6 2.6 0 1 0 5.2 0 2.6 2.6 0 1 0-5.2 0z" fill={INK} />
        </>
      )
    case 'headset':
      return (
        <>
          <path d="M14 36a18 18 0 0 1 36 0m0 6q-2 8-12 8" fill="none" {...stroke(2.4)} />
          <path
            d="M13.5 33a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3z m37 0a3 3 0 0 1 3 3v4a3 3 0 0 1-6 0v-4a3 3 0 0 1 3-3z m-15.5 17a2 2 0 1 0 4 0 2 2 0 1 0-4 0z"
            fill={INK}
          />
        </>
      )
    case 'coin':
      return (
        <>
          <path d="M42 52a8 8 0 1 0 16 0 8 8 0 1 0-16 0z" fill="#FACC15" {...stroke(1.6)} />
          <path
            d="M52.5 48.6c-1.1-1-4.6-1.2-4.7 1.1-0.1 2.2 4.6 1.9 4.5 4.5-0.1 2.4-3.7 2.3-4.9 1.2m2.6-9.2v11.6"
            fill="none"
            {...stroke(1.3)}
          />
        </>
      )
    case 'megaphone':
      return (
        <path
          d="M45 47l13-7 0 16-13-6z m-2.5-1h2a1.5 1.5 0 0 1 1.5 1.5v3a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5v-3a1.5 1.5 0 0 1 1.5-1.5z"
          fill="#FFFFFF"
          {...stroke(1.6)}
        />
      )
    case 'tie':
      return <path d="M29.5 51h5l-1 3 3 9-4.5 4-4.5-4 3-9z" fill="#DC2626" {...stroke(1.3)} />
    case 'magnifier':
      return (
        <>
          <path d="M42.5 49a6.5 6.5 0 1 0 13 0 6.5 6.5 0 1 0-13 0z" fill="#FFFFFFB3" {...stroke(2.2)} />
          <path d="M53.5 53.5l5.5 5.5" fill="none" {...stroke(3)} />
        </>
      )
    case 'spark':
      return (
        <>
          <path
            d="M32 0.5c1 5.5 2.3 6.9 7.5 7.8-5.2 0.9-6.5 2.3-7.5 7.7-1-5.4-2.3-6.8-7.5-7.7 5.2-0.9 6.5-2.3 7.5-7.8z"
            fill="var(--color-spark)"
            {...stroke(1.4)}
          />
          <path d="M42.4 5a1.6 1.6 0 1 0 3.2 0 1.6 1.6 0 1 0-3.2 0z" fill="var(--color-spark)" />
        </>
      )
    default:
      return null
  }
}

/**
 * Each helper's look, from the pen `Helper/*` components:
 * Chief blob+crown · Ops box+gear · Dev blob+glasses · Support bean+headset ·
 * Finance box+coin · Marketing blob+megaphone · Sales bean+tie · Retro blob+magnifier.
 */
export const HELPER_LOOK: Record<HelperArea, { shape: MascotShape; prop: MascotProp }> = {
  brand: { shape: 'blob', prop: 'crown' },
  ops: { shape: 'box', prop: 'gear' },
  dev: { shape: 'blob', prop: 'glasses' },
  support: { shape: 'bean', prop: 'headset' },
  finance: { shape: 'box', prop: 'coin' },
  marketing: { shape: 'blob', prop: 'megaphone' },
  sales: { shape: 'bean', prop: 'tie' },
  retro: { shape: 'blob', prop: 'magnifier' },
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
      playMascot({ shape: el.dataset.shape, prop: el.dataset.prop, color: el.dataset.color, mood: el.dataset.mood })
      if (reducedMotion()) return
      el.classList.remove('hop')
      void el.getBoundingClientRect()
      el.classList.add('hop')
      setTimeout(() => el.classList.remove('hop'), 520)
    },
    { passive: true },
  )
}

/** Voice tune per helper when no prop is drawn (plain mascots still sound like themselves). */
const VOICE: Record<HelperArea, MascotProp> = Object.fromEntries(
  Object.entries(HELPER_LOOK).map(([k, v]) => [k, v.prop]),
) as Record<HelperArea, MascotProp>

export interface MascotProps {
  /** Rendered width/height in px */
  size: number
  /** Corner radius in px. Defaults to the component's 18/64 ratio. */
  radius?: number
  /** Helper whose colour the body takes. Chief = brand. */
  area?: HelperArea
  /** Override the body colour (e.g. a custom company colour). */
  color?: string
  /**
   * Draw the helper's full look (`Helper/*` in pen: shape + prop). Off = the
   * plain blob (`Mascot` instances in chat threads, composer, rail mark).
   */
  helper?: boolean
  shape?: MascotShape
  prop?: MascotProp
  mood?: MascotMood
  /** Tinted tile behind the body (pen default). Set false for a bare mascot. */
  tile?: boolean
  /** Freeze: no blinking, no cursor-tracking (hover/hop still work). */
  still?: boolean
  /** Working: a gentle bob while the helper is busy. */
  working?: boolean
  className?: string
  title?: string
  style?: React.CSSProperties
}

/**
 * Omilo helper mascot — Chief and every agent.
 * Alive like in omilo-os: blinks (each at its own moment), eyes follow the
 * cursor, lifts and smiles on hover, hops and chirps on click, bobs while
 * working. Reduced-motion users get a still mascot.
 */
export function Mascot({
  size,
  radius,
  area = 'brand',
  color: colorOverride,
  helper = false,
  shape: shapeProp,
  prop: propProp,
  mood,
  tile = true,
  still = false,
  working = false,
  className = '',
  title,
  style,
}: MascotProps) {
  // The helper's saved Profile look (colour / shape / prop), if any.
  const saved = useMascotLook((s) => s.looks[area])
  const color = colorOverride ?? saved?.color ?? helperColor[area]
  const look = helper
    ? { shape: saved?.shape ?? HELPER_LOOK[area].shape, prop: saved?.prop ?? HELPER_LOOK[area].prop }
    : { shape: 'blob' as MascotShape, prop: 'none' as MascotProp }
  const shape = shapeProp ?? look.shape
  const prop = propProp ?? look.prop
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
      data-shape={shape}
      data-prop={prop === 'none' ? VOICE[area] : prop}
      data-color={color}
      data-mood={mood}
      className={`mascot relative inline-block shrink-0 overflow-hidden ${still || tiny ? 'still' : ''} ${
        working ? 'working' : ''
      } ${mood ? `mood-${mood}` : ''} ${className}`}
      style={{
        width: size,
        height: size,
        borderRadius: r,
        background: tile ? `linear-gradient(${color}29, ${color}29), #FFFFFF` : undefined,
        ...style,
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
          <path d={BODY[shape]} fill={color} />
          <g className="m-face">
            <path className="m-cheek" d={CHEEKS} fill="#FFFFFF4D" />
            <g className="m-eyes">
              <path d={EYES} fill={INK} />
              <path d={SHINE} fill="#FFFFFF" />
            </g>
            {mood === 'worried' && <path d={BROWS_WORRIED} fill="none" {...stroke(2)} />}
            {mood === 'sad' && <path d={BROWS_SAD} fill="none" {...stroke(2)} />}
            {mood === 'worried' ? (
              <path d={MOUTH_WORRIED} fill={INK} />
            ) : mood === 'sad' ? (
              <path d={MOUTH_SAD} fill="none" {...stroke(2.2)} />
            ) : mood === 'happy' ? (
              <path d={MOUTH_HAPPY} fill={INK} {...stroke(1.6)} />
            ) : (
              <>
                <path className="m-mouth" d={MOUTH} fill="none" {...stroke(2.2)} />
                <path className="m-mouth-happy" d={MOUTH_HAPPY} fill={INK} {...stroke(1.6)} />
              </>
            )}
            {mood === 'sad' && <path d={TEAR} fill="#7DD3FC" stroke="#0284C7" strokeWidth={0.8} />}
            {prop === 'glasses' && <Prop prop="glasses" />}
          </g>
          {prop !== 'glasses' && <Prop prop={prop} />}
        </g>
      </svg>
    </span>
  )
}

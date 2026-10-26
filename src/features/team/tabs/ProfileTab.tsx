import { useEffect, useRef, useState } from 'react'
import { Check, Crown, ImagePlus, Pause, Play, UserMinus } from 'lucide-react'
import { HELPER_LOOK, Mascot } from '../../../ui/ds/Mascot'
import type { MascotProp, MascotShape } from '../../../ui/ds/Mascot'
import { useMascotLook } from '../../../app/mascotLook'
import { helperColor } from '../../../ui/tokens'
import type { HelperRecord } from '../teamData'
import { Btn, InputField, SettingRow } from '../ui'
import { MenuItemBody, menuItemClass, menuSurface } from '../../../ui/ds/Menu'

const COLOURS = ['#EC4899', '#6366F1', '#14B8A6', '#F97316', '#8B5CF6', '#0EA5E9', '#65A30D', '#F59E0B', '#EF4444', '#64748B', '#A16207', '#06B6D4']
const REPORTS_TO_OPTIONS = ['You (Dede)', 'Chief of Staff'] as const
const SHAPES: MascotShape[] = ['bean', 'blob', 'box']
const PROPS: MascotProp[] = ['headset', 'crown', 'glasses', 'megaphone', 'tie', 'coin', 'gear', 'spark', 'magnifier', 'none']

function Label({ children }: { children: string }) {
  return <span className="text-[12.5px] font-medium text-ink-2">{children}</span>
}

function optRing(on: boolean) {
  return on ? 'outline-2 -outline-offset-2 outline-ink' : 'outline-1 -outline-offset-1 outline-line'
}

function ReportsToMenu({
  value,
  onPick,
  onClose,
}: {
  value: string
  onPick: (v: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.parentElement?.contains(e.target as Node)) onClose()
    }
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Reports to"
      className={`absolute top-[calc(100%+4px)] right-0 z-40 flex w-[200px] flex-col ${menuSurface}`}
    >
      {REPORTS_TO_OPTIONS.map((o) => (
        <button
          key={o}
          type="button"
          role="menuitemradio"
          aria-checked={value === o}
          className={`${menuItemClass} ${value === o ? 'bg-hover' : ''}`}
          onClick={() => { onPick(o); onClose() }}
        >
          <MenuItemBody icon={value === o ? Check : Crown} label={o} />
        </button>
      ))}
    </div>
  )
}

/** Profile tab — pen JVnGn. */
export function ProfileTab({ helper, onLetGo }: { helper: HelperRecord; onLetGo: () => void }) {
  const n = helper.name
  const look = HELPER_LOOK[helper.area]
  const base = helperColor[helper.area]
  const defaultColour = COLOURS.find((c) => c.toLowerCase() === String(base).toLowerCase()) ?? COLOURS[0]
  // Persisted look — every <Mascot area={helper.area}/> across the app reads this.
  const saved = useMascotLook((s) => s.looks[helper.area])
  const setLook = useMascotLook((s) => s.setLook)
  const resetLook = useMascotLook((s) => s.resetLook)
  const [colour, setColourState] = useState<string>(saved?.color ?? defaultColour)
  const [shape, setShapeState] = useState<MascotShape>(saved?.shape ?? look.shape)
  const [prop, setPropState] = useState<MascotProp>(saved?.prop ?? look.prop)
  const [paused, setPaused] = useState(false)
  const [reportsTo, setReportsTo] = useState<string>(helper.id === 'chief' ? 'You (Dede)' : 'Chief of Staff')
  const [reportsToOpen, setReportsToOpen] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const setColour = (c: string) => {
    setColourState(c)
    setLook(helper.area, { color: c })
  }
  const setShape = (s: MascotShape) => {
    setShapeState(s)
    setLook(helper.area, { shape: s })
  }
  const setProp = (p: MascotProp) => {
    setPropState(p)
    setLook(helper.area, { prop: p })
  }
  const reset = () => {
    setShapeState(look.shape)
    setPropState(look.prop)
    setColourState(defaultColour)
    resetLook(helper.area)
  }
  // Order the options so the helper's own shape / prop comes first, as in pen.
  const shapes = [look.shape, ...SHAPES.filter((s) => s !== look.shape)]
  const props = [look.prop, ...PROPS.filter((p) => p !== look.prop)]

  return (
    <div className="flex w-full flex-col gap-[20px]">
      <section className="flex w-full flex-col gap-[14px]">
        <div className="flex flex-col gap-[2px]">
          <h3 className="m-0 text-[14px] font-semibold text-ink">Look</h3>
          <p className="m-0 text-[12.5px] text-muted">
            How {n} appears in chats, the team list and notifications.
          </p>
        </div>
        <div className="flex w-full gap-[24px]">
          <div className="flex size-[168px] shrink-0 items-center justify-center rounded-lg bg-soft outline-1 -outline-offset-1 outline-line">
            <Mascot size={128} radius={36} color={colour} shape={shape} prop={prop} title={`${n} preview`} />
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-[16px]">
            <div className="flex flex-col gap-[8px]">
              <Label>Colour</Label>
              <div className="flex items-center gap-[8px]">
                {COLOURS.map((c) => {
                  const on = c === colour
                  return (
                    <button
                      key={c}
                      type="button"
                      aria-label={`Colour ${c}`}
                      aria-pressed={on}
                      onClick={() => setColour(c)}
                      className={`flex size-[30px] items-center justify-center rounded-pill ${optRing(on)}`}
                    >
                      <span className="rounded-full" style={{ background: c, width: on ? 22 : 24, height: on ? 22 : 24 }} />
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col gap-[8px]">
              <Label>Shape</Label>
              <div className="flex items-center gap-[8px]">
                {shapes.map((s) => (
                  <button
                    key={s}
                    type="button"
                    aria-label={`Shape ${s}`}
                    aria-pressed={s === shape}
                    onClick={() => setShape(s)}
                    className={`flex size-[52px] items-center justify-center rounded-md ${optRing(s === shape)}`}
                  >
                    <Mascot size={42} radius={12} color={colour} shape={s} prop={prop} still />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex flex-col gap-[8px]">
              <Label>Prop</Label>
              <div className="flex flex-wrap items-center gap-[8px]">
                {props.map((p) => (
                  <button
                    key={p}
                    type="button"
                    aria-label={`Prop ${p}`}
                    aria-pressed={p === prop}
                    onClick={() => setProp(p)}
                    className={`flex size-[52px] items-center justify-center rounded-md ${optRing(p === prop)}`}
                  >
                    <Mascot size={42} radius={12} color={colour} shape={shape} prop={p} still />
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-[12px]">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                aria-label="Upload picture"
                onChange={() => { /* stub — would set custom avatar */ }}
              />
              <Btn icon={ImagePlus} h={30} onClick={() => fileInputRef.current?.click()}>
                Use a picture
              </Btn>
              <Btn variant="quiet" h={30} onClick={reset}>
                Back to the original
              </Btn>
            </div>
          </div>
        </div>
      </section>

      <section className="flex w-full flex-col gap-[10px]">
        <h3 className="m-0 text-[14px] font-semibold text-ink">Name &amp; role</h3>
        <div className="flex w-full flex-col rounded-lg px-[16px] outline-1 -outline-offset-1 outline-line-strong">
          <SettingRow title="Name" desc="What residents and the team call it.">
            <InputField value={n} width={240} />
          </SettingRow>
          <SettingRow title="Job title" desc="Shown under the name in chats.">
            <InputField value={helper.id === 'support' ? 'Resident support · WhatsApp' : helper.roleArea} width={280} />
          </SettingRow>
          <SettingRow title="Reports to" desc="Gets its updates and escalations." last>
            <div className="relative">
              <button
                type="button"
                onClick={() => setReportsToOpen((v) => !v)}
                className="flex h-[36px] w-[240px] items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <Crown size={16} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{reportsTo}</span>
              </button>
              {reportsToOpen && (
                <ReportsToMenu
                  value={reportsTo}
                  onPick={setReportsTo}
                  onClose={() => setReportsToOpen(false)}
                />
              )}
            </div>
          </SettingRow>
        </div>
      </section>

      <section className="flex w-full flex-col gap-[10px]">
        <h3 className="m-0 text-[14px] font-semibold text-ink">Pause or let go</h3>
        <div className="flex w-full flex-col rounded-lg px-[16px] outline-1 -outline-offset-1 outline-line-strong">
          <SettingRow
            title={`${paused ? 'Resume' : 'Pause'} ${n}`}
            desc={paused ? `${n} is paused. Click Resume to restart replies and loops.` : `Stops all replies and loops. Residents see "we'll be right back". Resume anytime.`}
          >
            <Btn icon={paused ? Play : Pause} h={30} onClick={() => setPaused((p) => !p)}>
              {paused ? 'Resume' : 'Pause'}
            </Btn>
          </SettingRow>
          <SettingRow
            title={`Let ${n} go`}
            desc="Open chats go back to you. Files and memory are kept 30 days so you can rehire it."
            last
          >
            <Btn variant="danger" icon={UserMinus} h={30} onClick={onLetGo}>
              Let {n} go
            </Btn>
          </SettingRow>
        </div>
      </section>
    </div>
  )
}

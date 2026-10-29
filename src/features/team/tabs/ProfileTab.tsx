import { useEffect, useRef, useState } from 'react'
import { Check, Crown, ImagePlus, Pause, Play, UserMinus } from 'lucide-react'
import { HELPER_LOOK, Mascot } from '../../../ui/ds/Mascot'
import type { MascotProp, MascotShape } from '../../../ui/ds/Mascot'
import { useMascotLook } from '../../../app/mascotLook'
import { useHelpers, useUpdateHelperEverywhere } from '../../../app/queries'
import { useSession } from '../../../app/session'
import { notify } from '../../../ui/ds/Toaster'
import type { UpdateHelperInput } from '../../../adapters/http/commands'
import { helperColor } from '../../../ui/tokens'
import type { HelperRecord } from '../teamData'
import { Btn, InputField, SettingRow } from '../ui'
import { MenuItemBody, menuItemClass, menuSurface } from '../../../ui/ds/Menu'

const COLOURS = ['#EC4899', '#6366F1', '#14B8A6', '#F97316', '#8B5CF6', '#0EA5E9', '#65A30D', '#F59E0B', '#EF4444', '#64748B', '#A16207', '#06B6D4']
/** Pictures are stored inline on the helper; keep them small. */
const MAX_PICTURE_BYTES = 280_000
const SHAPES: MascotShape[] = ['bean', 'blob', 'box']
const PROPS: MascotProp[] = ['headset', 'crown', 'glasses', 'megaphone', 'tie', 'coin', 'gear', 'spark', 'magnifier', 'none']

function Label({ children }: { children: string }) {
  return <span className="text-[12.5px] font-medium text-ink-2">{children}</span>
}

function optRing(on: boolean) {
  return on ? 'outline-2 -outline-offset-2 outline-ink' : 'outline-1 -outline-offset-1 outline-line'
}

function ReportsToMenu({
  options,
  value,
  onPick,
  onClose,
}: {
  options: { value: string; label: string }[]
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
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={value === o.value}
          className={`${menuItemClass} ${value === o.value ? 'bg-hover' : ''}`}
          onClick={() => { onPick(o.value); onClose() }}
        >
          <MenuItemBody icon={value === o.value ? Check : Crown} label={o.label} />
        </button>
      ))}
    </div>
  )
}

/** Profile tab — pen JVnGn. */
export function ProfileTab({
  helper,
  onLetGo,
  onTogglePause,
}: {
  helper: HelperRecord
  /** Absent for the Chief, who can't be let go. */
  onLetGo?: () => void
  onTogglePause: () => void
}) {
  const n = helper.name
  const live = helper.helper
  const look = HELPER_LOOK[helper.area] ?? HELPER_LOOK.brand
  const base = helperColor[helper.area] ?? helperColor.brand
  const defaultColour = COLOURS.find((c) => c.toLowerCase() === String(base).toLowerCase()) ?? COLOURS[0]
  const updateHelper = useUpdateHelperEverywhere()
  const save = (input: UpdateHelperInput, ok?: string) =>
    updateHelper.mutate(
      { id: helper.id, input },
      { onSuccess: () => ok && notify(ok), onError: () => notify(`Couldn't update ${n}`) },
    )
  // The saved look lives on the helper (API); the local mascot store mirrors it
  // so every <Mascot area={helper.area}/> across the app reflects it.
  const saved = useMascotLook((s) => s.looks[helper.area])
  const setLook = useMascotLook((s) => s.setLook)
  const resetLook = useMascotLook((s) => s.resetLook)
  const [colour, setColourState] = useState<string>(live.look?.color ?? saved?.color ?? defaultColour)
  const [shape, setShapeState] = useState<MascotShape>((live.look?.shape as MascotShape) ?? saved?.shape ?? look.shape)
  const [prop, setPropState] = useState<MascotProp>((live.look?.prop as MascotProp) ?? saved?.prop ?? look.prop)
  const paused = helper.paused
  const ownerName = useSession((st) => st.user?.name) ?? 'you'
  const { data: team = [] } = useHelpers()
  const reportsOptions = [
    { value: 'owner', label: `You (${ownerName})` },
    ...team.filter((h) => h.id !== helper.id && h.isChief).map((h) => ({ value: h.id, label: h.title || h.role || h.name })),
  ]
  const chiefId = team.find((h) => h.isChief)?.id
  const reportsTo = live.reportsTo ?? (live.isChief || !chiefId ? 'owner' : chiefId)
  const reportsToText = reportsOptions.find((o) => o.value === reportsTo)?.label ?? `You (${ownerName})`
  const [reportsToOpen, setReportsToOpen] = useState(false)
  const [name, setName] = useState(n)
  const [jobTitle, setJobTitle] = useState(live.title ?? helper.roleArea)
  const [picture, setPicture] = useState<string | null>(live.look?.picture ?? null)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const currentLook = { color: colour, shape, prop, picture }
  const onPickPicture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    if (file.size > MAX_PICTURE_BYTES) {
      notify('That picture is too big — pick one under 280 KB')
      return
    }
    const reader = new FileReader()
    reader.onload = () => {
      if (typeof reader.result !== 'string') return
      setPicture(reader.result)
      save({ look: { ...currentLook, picture: reader.result } }, 'Picture saved')
    }
    reader.readAsDataURL(file)
  }

  const setColour = (c: string) => {
    setColourState(c)
    setLook(helper.area, { color: c })
    save({ look: { ...currentLook, color: c } })
  }
  const setShape = (sh: MascotShape) => {
    setShapeState(sh)
    setLook(helper.area, { shape: sh })
    save({ look: { ...currentLook, shape: sh } })
  }
  const setProp = (p: MascotProp) => {
    setPropState(p)
    setLook(helper.area, { prop: p })
    save({ look: { ...currentLook, prop: p } })
  }
  const reset = () => {
    setShapeState(look.shape)
    setPropState(look.prop)
    setColourState(defaultColour)
    setPicture(null)
    resetLook(helper.area)
    save({ look: null }, 'Back to the original look')
  }
  const commitName = () => {
    const v = name.trim()
    if (!v) return setName(n)
    if (v !== n) save({ name: v }, `Renamed to ${v}`)
  }
  const commitTitle = () => {
    const v = jobTitle.trim()
    if (v !== (live.title ?? helper.roleArea)) save({ title: v || null }, 'Job title saved')
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
          <div className="flex size-[168px] shrink-0 items-center justify-center overflow-hidden rounded-lg bg-soft outline-1 -outline-offset-1 outline-line">
            {picture ? (
              <img src={picture} alt={`${n} picture`} className="size-full object-cover" />
            ) : (
              <Mascot size={128} radius={36} color={colour} shape={shape} prop={prop} title={`${n} preview`} />
            )}
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
                onChange={onPickPicture}
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
          <SettingRow title="Name" desc="What customers and the team call it.">
            <span onBlur={commitName} onKeyDown={(e) => e.key === 'Enter' && commitName()}>
              <InputField value={name} onChange={setName} width={240} />
            </span>
          </SettingRow>
          <SettingRow title="Job title" desc="Shown under the name in chats.">
            <span onBlur={commitTitle} onKeyDown={(e) => e.key === 'Enter' && commitTitle()}>
              <InputField value={jobTitle} onChange={setJobTitle} width={280} />
            </span>
          </SettingRow>
          <SettingRow title="Reports to" desc="Gets its updates and escalations." last>
            <div className="relative">
              <button
                type="button"
                onClick={() => setReportsToOpen((v) => !v)}
                className="flex h-[36px] w-[240px] items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <Crown size={16} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{reportsToText}</span>
              </button>
              {reportsToOpen && (
                <ReportsToMenu
                  options={reportsOptions}
                  value={reportsTo}
                  onPick={(v) => save({ reportsTo: v }, 'Reporting line saved')}
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
            <Btn icon={paused ? Play : Pause} h={30} onClick={onTogglePause}>
              {paused ? 'Resume' : 'Pause'}
            </Btn>
          </SettingRow>
          {onLetGo ? (
            <SettingRow
              title={`Let ${n} go`}
              desc="It stops working and leaves the team. Its jobs, files and memory are kept."
              last
            >
              <Btn variant="danger" icon={UserMinus} h={30} onClick={onLetGo}>
                Let {n} go
              </Btn>
            </SettingRow>
          ) : (
            <SettingRow title="Chief stays on the team" desc="Every chat starts with Chief, so it can be paused but not let go." last>
              <span />
            </SettingRow>
          )}
        </div>
      </section>
    </div>
  )
}

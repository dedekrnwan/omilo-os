import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import * as Popover from '@radix-ui/react-popover'
import { Check, ImageUp, RotateCcw, Search, Trash2 } from 'lucide-react'
import type { Look } from '../../app/appearance'
import { ICONS, SWATCHES } from './iconCatalog'
import { menuSurface } from './Menu'

export type LookKind = 'area' | 'folder' | 'company'

export interface LookPickerProps {
  kind: LookKind
  /** Heading, e.g. "Engineering icon" */
  title: string
  /** Effective look (defaults merged with overrides) — drives the selected states. */
  value: Required<Pick<Look, 'color'>> & Look
  /** Called on every change with just the changed fields. */
  onChange: (patch: Look) => void
  onReset: () => void
  /** The element that opens the picker (icon badge, logo tile…). */
  children: ReactElement
  /** Open state, if the parent wants to control it (e.g. a context-menu entry). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  side?: 'right' | 'bottom'
}

/** Read an image file and downscale it to a 128px square data URL (keeps storage small). */
function readLogo(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error)
    reader.onload = () => {
      const img = new Image()
      img.onerror = () => reject(new Error('Not an image'))
      img.onload = () => {
        const size = 128
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(String(reader.result))
        const s = Math.min(img.width, img.height)
        ctx.drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, size, size)
        resolve(canvas.toDataURL('image/png'))
      }
      img.src = String(reader.result)
    }
    reader.readAsDataURL(file)
  })
}

function Swatches({ color, onPick }: { color: string; onPick: (c: string) => void }) {
  return (
    <div role="radiogroup" aria-label="Colour" className="grid grid-cols-12 gap-[4px] px-[12px] py-[8px]">
      {SWATCHES.map((c) => {
        const on = c.toLowerCase() === color.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={`Colour ${c}`}
            onClick={() => onPick(c)}
            className={`flex size-[20px] items-center justify-center rounded-full transition-transform hover:scale-110 ${
              on ? 'ring-2 ring-ink ring-offset-2 ring-offset-surface' : ''
            }`}
            style={{ background: c }}
          >
            {on && <Check size={11} strokeWidth={3} className="text-white" aria-hidden />}
          </button>
        )
      })}
    </div>
  )
}

/**
 * Picker for the look of an area, a folder (icon + colour) or a company
 * (logo image, or initials + colour). Changes apply live.
 */
export function LookPicker({
  kind,
  title,
  value,
  onChange,
  onReset,
  children,
  open,
  onOpenChange,
  side = 'right',
}: LookPickerProps) {
  const [query, setQuery] = useState('')
  const [error, setError] = useState<string | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const q = query.trim().toLowerCase()
  const icons = Object.entries(ICONS).filter(([k]) => k.includes(q))

  async function upload(file: File | undefined) {
    if (!file) return
    setError(null)
    try {
      onChange({ image: await readLogo(file) })
    } catch {
      setError('That file isn’t an image we can read.')
    }
  }

  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger asChild>{children}</Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          side={side}
          align="start"
          sideOffset={8}
          collisionPadding={8}
          aria-label={title}
          className={`z-50 flex w-[300px] flex-col !p-0 ${menuSurface}`}
        >
          <div className="flex items-center gap-[8px] px-[12px] pt-[10px] pb-[4px]">
            <span className="flex-1 truncate text-[13px] font-semibold text-ink">{title}</span>
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-[4px] rounded-sm px-[6px] py-[3px] text-[12px] text-muted hover:bg-hover hover:text-ink-2"
            >
              <RotateCcw size={12} aria-hidden />
              Reset
            </button>
          </div>

          {kind === 'company' && (
            <div className="flex items-center gap-[12px] px-[12px] py-[8px]">
              <span
                className="flex size-[48px] shrink-0 items-center justify-center overflow-hidden rounded-[12px] text-[19px] font-semibold text-white"
                style={{ background: value.image ? undefined : value.color }}
              >
                {value.image ? (
                  <img src={value.image} alt="" className="size-full object-cover" />
                ) : (
                  value.initial
                )}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[6px]">
                <div className="flex gap-[6px]">
                  <button
                    type="button"
                    onClick={() => fileRef.current?.click()}
                    className="inline-flex h-[28px] items-center gap-[5px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
                  >
                    <ImageUp size={14} aria-hidden className="text-ink-2" />
                    Upload logo
                  </button>
                  {value.image && (
                    <button
                      type="button"
                      aria-label="Remove logo image"
                      onClick={() => onChange({ image: undefined })}
                      className="inline-flex size-[28px] items-center justify-center rounded-btn text-muted outline-1 -outline-offset-1 outline-line-strong hover:bg-soft hover:text-bad"
                    >
                      <Trash2 size={14} aria-hidden />
                    </button>
                  )}
                </div>
                <label className="flex items-center gap-[6px] text-[12px] text-muted">
                  Initials
                  <input
                    value={value.initial ?? ''}
                    maxLength={2}
                    onChange={(e) => onChange({ initial: e.target.value.toUpperCase() })}
                    aria-label="Initials"
                    className="h-[24px] w-[44px] rounded-sm bg-surface px-[6px] text-center text-[12.5px] font-semibold text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-ink"
                  />
                </label>
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                hidden
                aria-label="Logo file"
                onChange={(e) => {
                  void upload(e.target.files?.[0])
                  e.target.value = ''
                }}
              />
            </div>
          )}
          {error && <p className="m-0 px-[12px] text-[12px] text-bad">{error}</p>}

          <Swatches color={value.color} onPick={(color) => onChange({ color })} />

          {kind !== 'company' && (
            <>
              <label className="mx-[12px] flex items-center gap-[8px] rounded-base bg-soft px-[8px] py-[6px] outline-1 -outline-offset-1 outline-line">
                <Search size={13} aria-hidden className="text-faint" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  placeholder="Search icons"
                  aria-label="Search icons"
                  className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-faint"
                />
              </label>
              <div role="radiogroup" aria-label="Icon" className="grid max-h-[208px] grid-cols-8 gap-[2px] overflow-y-auto p-[8px]">
                {icons.map(([key, Icon]) => {
                  const on = key === value.icon
                  return (
                    <button
                      key={key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      aria-label={key}
                      title={key}
                      onClick={() => onChange({ icon: key })}
                      className={`flex size-[32px] items-center justify-center rounded-sm transition-colors ${
                        on ? 'text-white' : 'text-ink-2 hover:bg-hover'
                      }`}
                      style={on ? { background: value.color } : undefined}
                    >
                      <Icon size={16} aria-hidden />
                    </button>
                  )
                })}
                {icons.length === 0 && (
                  <p className="col-span-8 m-0 py-[12px] text-center text-[12px] text-muted">No icon called “{query}”.</p>
                )}
              </div>
            </>
          )}
          {kind === 'company' && <div className="h-[4px]" />}
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  )
}

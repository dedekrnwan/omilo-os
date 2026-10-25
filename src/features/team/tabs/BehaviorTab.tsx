import { useEffect, useRef, useState } from 'react'
import { Check, Gauge, Hand, Languages, Plus, Send, User, Wallet, X, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { IconBtn, InputField, SettingRow, Switch, choiceRing } from '../ui'
import { MenuItemBody, menuItemClass, menuSurface } from '../../../ui/ds/Menu'

type Mode = 'Ask first' | 'Act, then report' | 'Fully on its own'

function OptionTile({
  icon: Icon,
  title,
  desc,
  selected,
  onPick,
}: {
  icon: LucideIcon
  title: string
  desc: string
  selected: boolean
  onPick: () => void
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={onPick}
      className={`flex min-w-0 flex-1 gap-[10px] rounded-md bg-surface px-[12px] py-[10px] text-left hover:bg-soft ${choiceRing(selected)}`}
    >
      <Icon size={18} aria-hidden className="shrink-0 text-ink-2" />
      <span className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <span className="text-[13.5px] font-medium text-ink">{title}</span>
        <span className="text-[12px] text-muted">{desc}</span>
      </span>
    </button>
  )
}

function Box({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col rounded-lg px-[16px] outline-1 -outline-offset-1 outline-line-strong">
      {children}
    </div>
  )
}

function Head({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="flex w-full items-center gap-[8px]">
      <h3 className="m-0 text-[14px] font-semibold text-ink">{title}</h3>
      {desc && <span className="text-[12.5px] text-muted">{desc}</span>}
    </div>
  )
}

const HANDOFF_OPTIONS = ['You (Dede)', 'Chief of Staff', 'Builder', 'Grower', 'Sales', 'Finance', 'Support'] as const
const LANGUAGE_OPTIONS = ['Bahasa Indonesia', 'English', 'Auto (detect)'] as const

function SimpleMenu<T extends string>({
  options,
  value,
  onPick,
  onClose,
  label,
}: {
  options: readonly T[]
  value: T
  onPick: (v: T) => void
  onClose: () => void
  label: string
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
      aria-label={label}
      className={`absolute top-[calc(100%+4px)] right-0 z-40 flex w-[200px] flex-col ${menuSurface}`}
    >
      {options.map((o) => (
        <button
          key={o}
          type="button"
          role="menuitemradio"
          aria-checked={value === o}
          className={`${menuItemClass} ${value === o ? 'bg-hover' : ''}`}
          onClick={() => { onPick(o); onClose() }}
        >
          <MenuItemBody icon={value === o ? Check : User} label={o} />
        </button>
      ))}
    </div>
  )
}

/** Behavior tab — pen C5M5HG. */
export function BehaviorTab({ helper }: { helper: HelperRecord }) {
  const n = helper.name
  const [mode, setMode] = useState<Mode>('Act, then report')
  const [override, setOverride] = useState(false)
  const [topics, setTopics] = useState<string[]>(['Money disputes', 'Legal', 'Politics'])
  const [addingTopic, setAddingTopic] = useState(false)
  const [topicInput, setTopicInput] = useState('')
  const [handoff, setHandoff] = useState<(typeof HANDOFF_OPTIONS)[number]>('You (Dede)')
  const [language, setLanguage] = useState<(typeof LANGUAGE_OPTIONS)[number]>('Bahasa Indonesia')
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const addInputRef = useRef<HTMLInputElement>(null)

  const modes: { id: Mode; icon: LucideIcon; desc: string }[] = [
    { id: 'Ask first', icon: Hand, desc: 'Drafts every reply, you send it' },
    { id: 'Act, then report', icon: Send, desc: 'Replies itself, tells you what it did' },
    { id: 'Fully on its own', icon: Zap, desc: 'Only pings you when stuck' },
  ]

  const commitTopic = () => {
    const t = topicInput.trim()
    if (t && !topics.includes(t)) setTopics((prev) => [...prev, t])
    setTopicInput('')
    setAddingTopic(false)
  }

  return (
    <div className="flex w-full flex-col gap-[20px]">
      <section className="flex w-full flex-col gap-[10px]">
        <Head title={`How much ${n} does on its own`} />
        <div className="flex w-full gap-[10px]">
          {modes.map((m) => (
            <OptionTile
              key={m.id}
              icon={m.icon}
              title={m.id}
              desc={m.desc}
              selected={mode === m.id}
              onPick={() => setMode(m.id)}
            />
          ))}
        </div>
      </section>

      <section className="flex w-full flex-col gap-[10px]">
        <Head title="Limits" desc="On top of the company's Safety & limits" />
        <Box>
          <SettingRow title="Spend per task" desc="Pauses and asks above this.">
            <InputField icon={Wallet} value="Rp 50.000" width={180} />
          </SettingRow>
          <SettingRow title="Messages per hour" desc="Stops a runaway loop on WhatsApp.">
            <InputField icon={Gauge} value="60" width={180} />
          </SettingRow>
          <SettingRow title="Never discuss" desc={`Topics ${n} always hands to you.`}>
            <div className="flex flex-wrap items-center gap-[6px]">
              {topics.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopics((prev) => prev.filter((x) => x !== t))}
                  className="flex items-center gap-[4px] rounded-sm bg-soft px-[8px] py-[3px] text-[12px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover"
                  aria-label={`Remove ${t}`}
                >
                  {t}
                  <X size={11} aria-hidden className="text-muted" />
                </button>
              ))}
              {addingTopic ? (
                <input
                  ref={addInputRef}
                  autoFocus
                  value={topicInput}
                  onChange={(e) => setTopicInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') commitTopic()
                    if (e.key === 'Escape') { setAddingTopic(false); setTopicInput('') }
                  }}
                  onBlur={commitTopic}
                  placeholder="Add topic…"
                  className="h-[26px] w-[120px] rounded-sm bg-surface px-[8px] text-[12px] text-ink outline-1 -outline-offset-1 outline-ink"
                />
              ) : (
                <IconBtn icon={Plus} label="Add topic" onClick={() => setAddingTopic(true)} />
              )}
            </div>
          </SettingRow>
          <SettingRow title="Work hours" desc="Uses the company hours: 08:00 – 21:00." last>
            <span className="text-[12.5px] text-muted">Override</span>
            <Switch on={override} onChange={setOverride} label="Override work hours" />
          </SettingRow>
        </Box>
      </section>

      <section className="flex w-full flex-col gap-[10px]">
        <Head title={`When ${n} is stuck`} />
        <Box>
          <SettingRow title="Hand off to" desc="Gets the chat and a short summary.">
            <div className="relative">
              <button
                type="button"
                onClick={() => setHandoffOpen((v) => !v)}
                className="flex h-[36px] w-[200px] items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <User size={16} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{handoff}</span>
              </button>
              {handoffOpen && (
                <SimpleMenu
                  options={HANDOFF_OPTIONS}
                  value={handoff}
                  onPick={setHandoff}
                  onClose={() => setHandoffOpen(false)}
                  label="Hand off to"
                />
              )}
            </div>
          </SettingRow>
          <SettingRow title="Language" desc="Replies in the resident's language if it can." last>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLanguageOpen((v) => !v)}
                className="flex h-[36px] w-[200px] items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <Languages size={16} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{language}</span>
              </button>
              {languageOpen && (
                <SimpleMenu
                  options={LANGUAGE_OPTIONS}
                  value={language}
                  onPick={setLanguage}
                  onClose={() => setLanguageOpen(false)}
                  label="Language"
                />
              )}
            </div>
          </SettingRow>
        </Box>
      </section>
    </div>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Check, Gauge, Hand, Languages, Plus, Send, User, Wallet, X, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import type { HelperBehavior } from '../../../core/domain/types'
import { useCompanySettings, useHelpers, useMembers, useUpdateHelperEverywhere } from '../../../app/queries'
import { useSession } from '../../../app/session'
import { notify } from '../../../ui/ds/Toaster'
import { parseTokens, tokensInput } from '../../analytics/format'
import { IconBtn, InputField, SettingRow, Switch, choiceRing } from '../ui'
import { MenuItemBody, menuItemClass, menuSurface } from '../../../ui/ds/Menu'

type Mode = 'Ask first' | 'Act, then report' | 'Fully on its own'
/** Behavior mode ↔ the helper's autonomy cap (strict | ask | yolo) the runner enforces. */
const MODE_CAP: Record<Mode, string> = { 'Ask first': 'strict', 'Act, then report': 'ask', 'Fully on its own': 'yolo' }
function modeOf(cap: string | null | undefined): Mode {
  if (cap === 'strict' || cap === 'review_first' || cap === 'off') return 'Ask first'
  if (cap === 'yolo') return 'Fully on its own'
  return 'Act, then report'
}

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

const LANGUAGE_OPTIONS = ['Bahasa Indonesia', 'English', 'Auto (detect)'] as const
const LANGUAGE_API: Record<string, string> = { 'Auto (detect)': 'auto' }
const DEFAULT_TOPICS = ['Money disputes', 'Legal', 'Politics']

function SimpleMenu({
  options,
  value,
  onPick,
  onClose,
  label,
}: {
  options: readonly { value: string; label: string }[]
  value: string
  onPick: (v: string) => void
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
          key={o.value}
          type="button"
          role="menuitemradio"
          aria-checked={value === o.value}
          className={`${menuItemClass} ${value === o.value ? 'bg-hover' : ''}`}
          onClick={() => { onPick(o.value); onClose() }}
        >
          <MenuItemBody icon={value === o.value ? Check : User} label={o.label} />
        </button>
      ))}
    </div>
  )
}

/** Behavior tab — pen C5M5HG. */
export function BehaviorTab({ helper }: { helper: HelperRecord }) {
  const n = helper.name
  const live = helper.helper
  const b: HelperBehavior = live.behavior ?? {}
  const updateHelper = useUpdateHelperEverywhere()
  const save = (input: Parameters<typeof updateHelper.mutate>[0]['input'], ok?: string) =>
    updateHelper.mutate(
      { id: helper.id, input },
      { onSuccess: () => ok && notify(ok), onError: () => notify(`Couldn't save ${n}'s behavior`) },
    )
  const saveBehavior = (patch: HelperBehavior | Record<string, null>, ok?: string) => save({ behavior: patch }, ok)

  const ownerName = useSession((st) => st.user?.name) ?? 'you'
  const { data: team = [] } = useHelpers()
  const { data: members = [] } = useMembers()
  const { data: settings } = useCompanySettings()
  const hoursLabel =
    settings?.hours && typeof (settings.hours as { label?: unknown }).label === 'string'
      ? (settings.hours as { label: string }).label
      : null

  const mode = modeOf(live.autonomyCap)
  const override = !!b.work_hours_override
  const topics = b.never_discuss ?? DEFAULT_TOPICS
  const [addingTopic, setAddingTopic] = useState(false)
  const [topicInput, setTopicInput] = useState('')
  const handoffOptions = [
    { value: 'owner', label: `You (${ownerName})` },
    ...members.filter((m) => m.role !== 'owner').map((m) => ({ value: `member:${m.id}`, label: m.name })),
    ...team.filter((h) => h.id !== helper.id).map((h) => ({ value: `helper:${h.id}`, label: h.isChief ? h.title || h.role || h.name : h.name })),
  ]
  const handoff = b.handoff_to ?? 'owner'
  const handoffLabel = handoffOptions.find((o) => o.value === handoff)?.label ?? `You (${ownerName})`
  const languageLabel =
    LANGUAGE_OPTIONS.find((l) => (LANGUAGE_API[l] ?? l) === b.language) ?? 'Auto (detect)'
  const [handoffOpen, setHandoffOpen] = useState(false)
  const [languageOpen, setLanguageOpen] = useState(false)
  const [spend, setSpend] = useState(tokensInput(b.tokens_per_task))
  const [rate, setRate] = useState(b.messages_per_hour ? String(b.messages_per_hour) : '')
  const addInputRef = useRef<HTMLInputElement>(null)

  const setMode = (m: Mode) => save({ autonomyCap: MODE_CAP[m] }, `${n}: ${m}`)
  const setOverride = (v: boolean) => saveBehavior({ work_hours_override: v })
  const setTopics = (next: string[]) => saveBehavior({ never_discuss: next })
  const commitSpend = () => {
    const tokens = parseTokens(spend)
    if (!tokens) {
      setSpend('')
      if (b.tokens_per_task) saveBehavior({ tokens_per_task: null }, 'Token limit removed')
      return
    }
    setSpend(tokensInput(tokens))
    if (tokens !== b.tokens_per_task) saveBehavior({ tokens_per_task: tokens }, 'Token limit saved')
  }
  const commitRate = () => {
    const v = Number(rate.replace(/[^0-9]/g, ''))
    if (!v) {
      setRate('')
      if (b.messages_per_hour) saveBehavior({ messages_per_hour: null }, 'Message limit removed')
      return
    }
    setRate(String(v))
    if (v !== b.messages_per_hour) saveBehavior({ messages_per_hour: v }, 'Message limit saved')
  }

  const modes: { id: Mode; icon: LucideIcon; desc: string }[] = [
    { id: 'Ask first', icon: Hand, desc: 'Drafts every reply, you send it' },
    { id: 'Act, then report', icon: Send, desc: 'Replies itself, tells you what it did' },
    { id: 'Fully on its own', icon: Zap, desc: 'Only pings you when stuck' },
  ]

  const commitTopic = () => {
    const t = topicInput.trim()
    if (t && !topics.includes(t)) setTopics([...topics, t])
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
          <SettingRow title="Tokens per task" desc="AI tokens one task may use (e.g. 200k). Pauses and asks above this.">
            <span onBlur={commitSpend} onKeyDown={(e) => e.key === 'Enter' && commitSpend()}>
              <InputField icon={Wallet} value={spend} onChange={setSpend} placeholder="No limit" width={180} />
            </span>
          </SettingRow>
          <SettingRow title="Messages per hour" desc="Stops a runaway loop on WhatsApp.">
            <span onBlur={commitRate} onKeyDown={(e) => e.key === 'Enter' && commitRate()}>
              <InputField icon={Gauge} value={rate} onChange={setRate} placeholder="No limit" width={180} />
            </span>
          </SettingRow>
          <SettingRow title="Never discuss" desc={`Topics ${n} always hands to you.`}>
            <div className="flex flex-wrap items-center gap-[6px]">
              {topics.map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => setTopics(topics.filter((x) => x !== t))}
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
          <SettingRow
            title="Work hours"
            desc={hoursLabel ? `Uses the company hours: ${hoursLabel}.` : 'Uses the company hours.'}
            last
          >
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
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{handoffLabel}</span>
              </button>
              {handoffOpen && (
                <SimpleMenu
                  options={handoffOptions}
                  value={handoff}
                  onPick={(v) => saveBehavior({ handoff_to: v }, 'Hand-off saved')}
                  onClose={() => setHandoffOpen(false)}
                  label="Hand off to"
                />
              )}
            </div>
          </SettingRow>
          <SettingRow title="Language" desc="Replies in the customer's language if it can." last>
            <div className="relative">
              <button
                type="button"
                onClick={() => setLanguageOpen((v) => !v)}
                className="flex h-[36px] w-[200px] items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
              >
                <Languages size={16} aria-hidden className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{languageLabel}</span>
              </button>
              {languageOpen && (
                <SimpleMenu
                  options={LANGUAGE_OPTIONS.map((l) => ({ value: l, label: l }))}
                  value={languageLabel}
                  onPick={(v) => saveBehavior({ language: LANGUAGE_API[v] ?? v }, 'Language saved')}
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

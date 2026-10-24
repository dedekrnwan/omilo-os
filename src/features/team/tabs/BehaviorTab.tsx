import { useState } from 'react'
import { Gauge, Hand, Languages, Plus, Send, User, Wallet, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { Chip, IconBtn, InputField, SelectField, SettingRow, Switch, choiceRing } from '../ui'

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

/** Behavior tab — pen C5M5HG. */
export function BehaviorTab({ helper }: { helper: HelperRecord }) {
  const n = helper.name
  const [mode, setMode] = useState<Mode>('Act, then report')
  const [override, setOverride] = useState(false)
  const modes: { id: Mode; icon: LucideIcon; desc: string }[] = [
    { id: 'Ask first', icon: Hand, desc: 'Drafts every reply, you send it' },
    { id: 'Act, then report', icon: Send, desc: 'Replies itself, tells you what it did' },
    { id: 'Fully on its own', icon: Zap, desc: 'Only pings you when stuck' },
  ]
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
            <div className="flex items-center gap-[6px]">
              {['Money disputes', 'Legal', 'Politics'].map((t) => (
                <Chip key={t} tone="neutral" className="self-center">
                  {t}
                </Chip>
              ))}
              <IconBtn icon={Plus} label="Add topic" />
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
            <SelectField icon={User} value="You (Dede)" width={200} />
          </SettingRow>
          <SettingRow title="Language" desc="Replies in the resident's language if it can." last>
            <SelectField icon={Languages} value="Bahasa Indonesia" width={200} />
          </SettingRow>
        </Box>
      </section>
    </div>
  )
}

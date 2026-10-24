import { useState } from 'react'
import { ArrowUpRight, Building2, CreditCard, Database, Globe, HardDrive, MessageCircle, Notebook, Search, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import { GithubIcon } from '../brandIcons'
import { Btn, Chip, SelectField, Switch } from '../ui'

interface ToolRow {
  name: string
  desc: string
  icon: LucideIcon
  bg?: string
  access?: string
  on: boolean
  mcp?: boolean
}

function Row({ t, last }: { t: ToolRow; last: boolean }) {
  const [on, setOn] = useState(t.on)
  return (
    <div className={`flex w-full items-center gap-[12px] py-[12px] ${last ? '' : 'shadow-[inset_0_-1px_0_var(--color-line)]'}`}>
      <span
        className={`flex size-[32px] shrink-0 items-center justify-center rounded-base ${t.bg ? '' : 'bg-soft'}`}
        style={t.bg ? { background: t.bg } : undefined}
      >
        <t.icon size={16} aria-hidden className={t.bg ? 'text-white' : on ? 'text-ink' : 'text-muted'} />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <div className="flex items-center gap-[6px]">
          <span className={`text-[13.5px] font-medium ${on ? 'text-ink' : 'text-muted'}`}>{t.name}</span>
          {t.mcp && (
            <Chip tone="neutral" h={18} labelClass="text-[11px] font-mono">
              MCP
            </Chip>
          )}
        </div>
        <span className="text-[12px] text-muted">{t.desc}</span>
      </div>
      {t.access && <SelectField value={t.access} width={150} style={{ opacity: on ? 1 : 0.5 }} />}
      <Switch on={on} onChange={setOn} label={`${t.name} on`} />
    </div>
  )
}

function Group({ title, desc, rows }: { title: string; desc: string; rows: ToolRow[] }) {
  return (
    <section className="flex w-full flex-col gap-[10px]">
      <div className="flex w-full items-center gap-[8px]">
        <h3 className="m-0 text-[14px] font-semibold text-ink">{title}</h3>
        <span className="text-[12.5px] text-muted">{desc}</span>
      </div>
      <div className="flex w-full flex-col rounded-lg px-[16px] outline-1 -outline-offset-1 outline-line-strong">
        {rows.map((t, i) => (
          <Row key={t.name} t={t} last={i === rows.length - 1} />
        ))}
      </div>
    </section>
  )
}

/** Tools tab — pen e4QAdg. */
export function ToolsTab({ helper }: { helper: HelperRecord }) {
  const n = helper.name
  const company: ToolRow[] = [
    { name: 'WhatsApp Business', desc: 'Read and reply to resident chats', icon: MessageCircle, bg: '#25D366', access: 'Can act', on: true },
    { name: 'Notion', desc: 'Look up the resident handbook and FAQ', icon: Notebook, access: 'Read only', on: true },
    { name: 'Google Drive', desc: 'Find letters and forms to send', icon: HardDrive, access: 'Read only', on: true },
    { name: 'Midtrans', desc: "Check if a resident's dues are paid", icon: CreditCard, access: 'Ask first', on: true },
    { name: 'sahabat-db', desc: 'Resident & unit records, read-only queries', icon: Database, access: 'Read only', on: true, mcp: true },
    { name: 'GitHub', desc: `Not needed for ${n}'s job`, icon: GithubIcon, access: 'Read only', on: false },
  ]
  const builtIn: ToolRow[] = [
    { name: 'Browser', desc: 'Open pages and fill simple forms', icon: Globe, on: true },
    { name: 'Web search', desc: 'Look things up when the handbook has no answer', icon: Search, on: true },
    { name: 'Code runner', desc: 'Run small scripts on files', icon: Terminal, on: false },
  ]
  return (
    <div className="flex w-full flex-col gap-[20px]">
      <div className="flex w-full items-center gap-[12px] rounded-md bg-info-tint px-[14px] py-[12px] outline-1 -outline-offset-1 outline-info-line">
        <Building2 size={16} aria-hidden className="shrink-0 text-info" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-ink">
            Connectors and MCP servers are set up once for the company
          </span>
          <span className="text-[12.5px] text-ink-2">
            Add or remove them in Control panel → Connectors. Here you only decide which ones {n} may use, and how much.
          </span>
        </div>
        <Btn icon={ArrowUpRight} h={30}>
          Open Connectors
        </Btn>
      </div>
      <Group title="From the company" desc="5 connectors · 1 MCP server" rows={company} />
      <Group title="Built in" desc="Come with every helper" rows={builtIn} />
    </div>
  )
}

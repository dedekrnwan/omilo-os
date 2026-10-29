import { ArrowUpRight, Building2, Globe, Plug, Search, Terminal } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { useHelperTools, useSetHelperTools } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import type { HelperRecord } from '../teamData'
import { Btn, Chip, SelectField, Switch } from '../ui'
import type { SelectOption } from '../ui'

interface ToolRow {
  id: string
  name: string
  desc: string
  icon: LucideIcon
  bg?: string
  /** 'read' | 'write' | 'ask' for company connectors; undefined for built-ins. */
  access?: string
  on: boolean
  mcp?: boolean
}

const ACCESS_OPTIONS: readonly SelectOption[] = [
  { value: 'write', label: 'Can act' },
  { value: 'read', label: 'Read only' },
  { value: 'ask', label: 'Ask first' },
]
const BUILTIN_ICON: Record<string, LucideIcon> = { browser: Globe, web_search: Search, code_runner: Terminal }

function Row({
  t,
  last,
  onToggle,
  onAccess,
}: {
  t: ToolRow
  last: boolean
  onToggle: (on: boolean) => void
  onAccess?: (access: string) => void
}) {
  const on = t.on
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
      {t.access && (
        <SelectField
          value={t.access}
          options={ACCESS_OPTIONS}
          onChange={(v) => on && onAccess?.(v)}
          width={150}
          style={{ opacity: on ? 1 : 0.5 }}
        />
      )}
      <Switch on={on} onChange={onToggle} label={`${t.name} on`} />
    </div>
  )
}

function Group({
  title,
  desc,
  rows,
  empty,
  onToggle,
  onAccess,
}: {
  title: string
  desc: string
  rows: ToolRow[]
  empty?: string
  onToggle: (t: ToolRow, on: boolean) => void
  onAccess?: (t: ToolRow, access: string) => void
}) {
  return (
    <section className="flex w-full flex-col gap-[10px]">
      <div className="flex w-full items-center gap-[8px]">
        <h3 className="m-0 text-[14px] font-semibold text-ink">{title}</h3>
        <span className="text-[12.5px] text-muted">{desc}</span>
      </div>
      <div className="flex w-full flex-col rounded-lg px-[16px] outline-1 -outline-offset-1 outline-line-strong">
        {rows.length === 0 && empty && <span className="py-[12px] text-[12.5px] text-muted">{empty}</span>}
        {rows.map((t, i) => (
          <Row
            key={t.id}
            t={t}
            last={i === rows.length - 1}
            onToggle={(v) => onToggle(t, v)}
            onAccess={onAccess ? (a) => onAccess(t, a) : undefined}
          />
        ))}
      </div>
    </section>
  )
}

/** Tools tab — pen e4QAdg. */
export function ToolsTab({ helper }: { helper: HelperRecord }) {
  const navigate = useNavigate()
  const n = helper.name
  const { data, isLoading } = useHelperTools(helper.id)
  const setTools = useSetHelperTools(helper.id)
  const company: ToolRow[] = (data?.connectors ?? []).map((c) => ({
    id: c.id,
    name: c.label,
    desc: c.status === 'connected' ? `Connected for the company` : `Needs sign-in in Connectors`,
    icon: Plug,
    access: c.access,
    on: c.on,
    mcp: c.kind === 'mcp',
  }))
  const builtIn: ToolRow[] = (data?.builtins ?? []).map((b) => ({
    id: b.id,
    name: b.label,
    desc: b.desc,
    icon: BUILTIN_ICON[b.id] ?? Globe,
    on: b.on,
  }))
  const fail = () => notify(`Couldn't update ${n}'s tools`)
  const toggleConnector = (t: ToolRow, on: boolean) =>
    setTools.mutate({ connectors: [{ id: t.id, on, access: t.access }] }, { onError: fail })
  const setAccess = (t: ToolRow, access: string) =>
    setTools.mutate({ connectors: [{ id: t.id, on: true, access }] }, { onError: fail })
  const toggleBuiltin = (t: ToolRow, on: boolean) => setTools.mutate({ builtins: { [t.id]: on } }, { onError: fail })
  const mcpCount = company.filter((c) => c.mcp).length
  const companyDesc = isLoading
    ? 'Loading…'
    : `${company.length - mcpCount} connector${company.length - mcpCount === 1 ? '' : 's'}${mcpCount ? ` · ${mcpCount} MCP server${mcpCount === 1 ? '' : 's'}` : ''}`
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
        <Btn
          icon={ArrowUpRight}
          h={30}
          onClick={() => void navigate({ to: '/control-panel/$section', params: { section: 'connectors' } })}
        >
          Open Connectors
        </Btn>
      </div>
      <Group
        title="From the company"
        desc={companyDesc}
        rows={company}
        empty={isLoading ? undefined : 'No connectors yet — add them in Control panel → Connectors.'}
        onToggle={toggleConnector}
        onAccess={setAccess}
      />
      <Group title="Built in" desc="Come with every helper" rows={builtIn} onToggle={toggleBuiltin} />
    </div>
  )
}

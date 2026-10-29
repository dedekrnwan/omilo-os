import { useState } from 'react'
import type { ReactNode } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Check, ChevronsUpDown, Coins, FlaskConical, Loader2, Plus, X } from 'lucide-react'
import type { HelperArea } from '../../../../core/domain/types'
import { Mascot } from '../../../../ui/ds/Mascot'
import { menuItemClass, menuSurface } from '../../../../ui/ds/Menu'
import { MoreMenu } from '../../../../ui/ds/ItemMenu'
import { stepMenu } from './stepMenu'
import { RUN_DETAIL } from './data'
import type { AiStepDetail, FlowNode } from './data'
import { APP_ICON, StepTile, nodeGlyph } from './icons'
import { blankAi, useFlow, useFlowStore } from './store'

const HELPERS: { id: HelperArea; name: string }[] = [
  { id: 'ops', name: 'Ops' },
  { id: 'dev', name: 'Dev' },
  { id: 'support', name: 'Support' },
  { id: 'finance', name: 'Finance' },
  { id: 'marketing', name: 'Marketing' },
  { id: 'sales', name: 'Sales' },
  { id: 'brand', name: 'Chief' },
]
const helperName = (h: HelperArea) => HELPERS.find((x) => x.id === h)?.name ?? 'Ops'

const KIND_NAME: Record<FlowNode['kind'], string> = {
  trigger: 'TRIGGER',
  ai: 'AI STEP',
  if: 'IF / BRANCH',
  approval: 'APPROVAL',
  connector: 'CONNECTOR',
}

// ── Small controls ───────────────────────────────────────────────────────────

function Label({ children, hint }: { children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="flex items-center gap-[8px]">
      <span className="flex-1 text-[12.5px] font-semibold text-ink">{children}</span>
      {hint && <span className="text-[11.5px] text-faint">{hint}</span>}
    </div>
  )
}

function Section({ label, hint, children }: { label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <section aria-label={label} className="flex flex-col gap-[6px]">
      <Label hint={hint}>{label}</Label>
      {children}
    </section>
  )
}

/** Dark 26×14 switch used for guardrails. */
export function MiniSwitch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="group flex h-[21px] w-full items-center gap-[8px] rounded-xs text-left outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <span className={`relative inline-flex h-[14px] w-[26px] shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-line-strong'}`}>
        <span className={`absolute top-[2px] size-[10px] rounded-full bg-surface transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-[2px]'}`} />
      </span>
      <span className="truncate text-[12.5px] text-ink-2">{label}</span>
    </button>
  )
}

const inputBox =
  'w-full rounded-base bg-surface px-[10px] text-[12.5px] text-ink outline-1 -outline-offset-1 outline-line-strong placeholder:text-faint focus:outline-ink'

function TextInput({ value, onChange, label, mono }: { value: string; onChange: (v: string) => void; label: string; mono?: boolean }) {
  return (
    <input
      aria-label={label}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className={`${inputBox} h-[32px] ${mono ? 'font-mono text-[12px]' : ''}`}
    />
  )
}

function Select<T extends string>({
  value,
  options,
  onChange,
  label,
  leading,
}: {
  value: T
  options: { id: T; name: string; leading?: ReactNode }[]
  onChange: (v: T) => void
  label: string
  leading?: ReactNode
}) {
  const cur = options.find((o) => o.id === value)
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-[32px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft focus-visible:outline-ink data-[state=open]:outline-ink"
        >
          {leading ?? cur?.leading}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink">{cur?.name ?? value}</span>
          <ChevronsUpDown size={13} aria-hidden className="text-faint" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="start" sideOffset={4} className={`z-50 w-[var(--radix-dropdown-menu-trigger-width)] ${menuSurface}`}>
          {options.map((o) => (
            <Dropdown.Item key={o.id} className={menuItemClass} onSelect={() => onChange(o.id)}>
              {o.leading}
              <span className="flex-1 text-[13px] text-ink">{o.name}</span>
              {o.id === value && <Check size={14} aria-hidden className="text-ink-2" />}
            </Dropdown.Item>
          ))}
        </Dropdown.Content>
      </Dropdown.Portal>
    </Dropdown.Root>
  )
}

function Token({ children }: { children: ReactNode }) {
  return <span className="mx-[2px] inline-flex h-[17px] items-center rounded-xs bg-[#FEF3C7] px-[6px] align-[1px] font-mono text-[11px] text-[#92400E]">{children}</span>
}

function ChipList({ items, onRemove, onAdd }: { items: string[]; onRemove?: (i: number) => void; onAdd?: (v: string) => void }) {
  const [adding, setAdding] = useState(false)
  const [v, setV] = useState('')
  return (
    <div className="flex flex-wrap items-center gap-[6px]">
      {items.map((it, i) => (
        <span key={`${it}-${i}`} className="group inline-flex h-[17px] items-center gap-[3px] rounded-xs bg-app px-[6px] font-mono text-[11px] text-ink-2">
          {it}
          {onRemove && (
            <button type="button" aria-label={`Remove ${it}`} onClick={() => onRemove(i)} className="hidden text-faint group-hover:inline-flex hover:text-ink">
              <X size={10} aria-hidden />
            </button>
          )}
        </span>
      ))}
      {onAdd &&
        (adding ? (
          <input
            autoFocus
            aria-label="New field name"
            value={v}
            onChange={(e) => setV(e.target.value.replace(/\s+/g, '_'))}
            onBlur={() => {
              if (v) onAdd(v)
              setV('')
              setAdding(false)
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
              if (e.key === 'Escape') {
                setV('')
                setAdding(false)
              }
            }}
            className="h-[17px] w-[80px] rounded-xs bg-surface px-[4px] font-mono text-[11px] text-ink outline-1 outline-line-strong"
          />
        ) : (
          <button
            type="button"
            aria-label="Add a field"
            onClick={() => setAdding(true)}
            className="inline-flex size-[17px] items-center justify-center rounded-xs text-faint hover:bg-app hover:text-ink-2"
          >
            <Plus size={11} aria-hidden />
          </button>
        ))}
    </div>
  )
}

function Note({ children }: { children: ReactNode }) {
  return (
    <div className="flex h-[35px] items-center gap-[8px] rounded-base bg-soft px-[11px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line">
      <Coins size={13} aria-hidden className="shrink-0 text-muted" />
      <span className="truncate">{children}</span>
    </div>
  )
}

// ── Per-kind bodies ──────────────────────────────────────────────────────────

function AiBody({ flowId, node }: { flowId: string; node: FlowNode }) {
  const f = useFlow(flowId)
  const { updateAi, updateNode } = useFlowStore()
  const ai: AiStepDetail = f.ai[node.id] ?? blankAi()
  const [editing, setEditing] = useState(false)
  const helper = node.helper ?? 'ops'
  return (
    <>
      <Section label="Agent">
        <Select
          label="Agent"
          value={helper}
          onChange={(h) => updateNode(flowId, node.id, { helper: h, source: helperName(h) })}
          options={HELPERS.map((h) => ({ id: h.id, name: h.name, leading: <Mascot size={16} radius={4} area={h.id} still /> }))}
        />
      </Section>
      <Section label="Instructions" hint="type / for inputs">
        {editing ? (
          <textarea
            autoFocus
            aria-label="Instructions"
            value={ai.instructions}
            onChange={(e) => updateAi(flowId, node.id, { instructions: e.target.value })}
            onBlur={() => setEditing(false)}
            rows={4}
            className={`${inputBox} resize-none py-[9px] leading-[19.5px] text-ink-2`}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditing(true)}
            aria-label="Edit instructions"
            className="rounded-base bg-surface px-[10px] pt-[8px] pb-[9px] text-left text-[12.5px] leading-[19.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:outline-wire-strong"
          >
            <span className="block leading-[22px]">
              {ai.instructionsLead}
              <Token>{ai.input}</Token>
            </span>
            {ai.instructions}
          </button>
        )}
      </Section>
      <Section label="Returns">
        <ChipList
          items={ai.returns}
          onRemove={(i) => updateAi(flowId, node.id, { returns: ai.returns.filter((_, j) => j !== i) })}
          onAdd={(v) => updateAi(flowId, node.id, { returns: [...ai.returns, v] })}
        />
      </Section>
      <Section label="Guardrails">
        <div className="-mt-[2px] flex flex-col">
          {ai.guardrails.map((g, i) => (
            <MiniSwitch
              key={g.label}
              label={g.label}
              on={g.on}
              onChange={(on) => updateAi(flowId, node.id, { guardrails: ai.guardrails.map((x, j) => (j === i ? { ...x, on } : x)) })}
            />
          ))}
        </div>
      </Section>
      <div className="-mt-[3px]">
        <Note>{ai.costNote}</Note>
      </div>
    </>
  )
}

function TriggerBody({ flowId, node }: { flowId: string; node: FlowNode }) {
  const { updateNode } = useFlowStore()
  const branch = (node.config?.branch as string | undefined) ?? 'main'
  const setBranch = (v: string) => updateNode(flowId, node.id, { config: { ...node.config, branch: v } })
  return (
    <>
      <Section label="App">
        <Select
          label="App"
          value={node.source ?? 'GitHub'}
          onChange={(v) => updateNode(flowId, node.id, { source: v })}
          options={['GitHub', 'Schedule', 'Webhook', 'Slack', 'Stripe'].map((n) => ({ id: n, name: n }))}
        />
      </Section>
      <Section label="When">
        <Select
          label="Event"
          value={node.title}
          onChange={(v) => updateNode(flowId, node.id, { title: v })}
          options={['Deploy fails on main', 'Deploy succeeds', 'Pull request opened', 'Issue labelled “bug”'].map((n) => ({ id: n, name: n }))}
        />
      </Section>
      <Section label="Only on branch">
        <TextInput label="Branch" value={branch} onChange={setBranch} mono />
      </Section>
      <Section label="Passes on">
        <ChipList items={['logs', 'commit', 'job_url', 'author']} />
      </Section>
    </>
  )
}

function IfBody({ flowId, node }: { flowId: string; node: FlowNode }) {
  const { updateNode } = useFlowStore()
  const [values, setValues] = useState(['P0', 'P1'])
  return (
    <>
      <Section label="Condition">
        <div className="flex flex-col gap-[6px] rounded-base bg-soft p-[10px] outline-1 -outline-offset-1 outline-line">
          <div className="flex items-center gap-[6px] text-[12.5px] text-ink-2">
            <Token>ReadLogs.severity</Token>
            <span>is one of</span>
          </div>
          <div className="flex flex-wrap gap-[6px]">
            {['P0', 'P1', 'P2', 'P3'].map((p) => {
              const on = values.includes(p)
              return (
                <button
                  key={p}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    const next = on ? values.filter((x) => x !== p) : [...values, p].sort()
                    setValues(next)
                    updateNode(flowId, node.id, { title: next.length ? `If severity is ${next.join(' or ')}` : 'If …' })
                  }}
                  className={`h-[24px] rounded-sm px-[9px] text-[12px] font-medium ${on ? 'bg-primary text-primary-ink' : 'bg-surface text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover'}`}
                >
                  {p}
                </button>
              )
            })}
          </div>
        </div>
      </Section>
      <Section label="Branches">
        <div className="flex flex-col gap-[6px] text-[12.5px] text-ink-2">
          <span className="flex items-center gap-[8px]">
            <span className="rounded-xs bg-[#FEF3C7] px-[6px] text-[10.5px] font-semibold text-warn">Yes</span>
            You approve the fix
          </span>
          <span className="flex items-center gap-[8px]">
            <span className="rounded-xs bg-app px-[6px] text-[10.5px] font-semibold text-muted">No</span>
            Post summary to #Engineering
          </span>
        </div>
      </Section>
      <Note>No AI here — free to run</Note>
    </>
  )
}

function ApprovalBody({ flowId, node }: { flowId: string; node: FlowNode }) {
  const { updateNode } = useFlowStore()
  const cfg = node.config ?? {}
  const wait = (cfg.wait as string | undefined) ?? '1 hour'
  const inbox = (cfg.inbox as boolean | undefined) ?? true
  const whatsapp = (cfg.whatsapp as boolean | undefined) ?? false
  const timeout = (cfg.onTimeout as string | undefined) ?? 'remind'
  const patch = (p: Record<string, unknown>) => updateNode(flowId, node.id, { config: { ...cfg, ...p } })
  return (
    <>
      <Section label="Who approves">
        <div className="flex h-[32px] items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
          <span className="flex size-[18px] items-center justify-center rounded-full bg-[#F97316] text-[9px] font-semibold text-white">DK</span>
          <span className="flex-1 text-[13px] text-ink">You</span>
          <span className="text-[11.5px] text-faint">Owner</span>
        </div>
      </Section>
      <Section label="Ask in">
        <div className="flex flex-col">
          <MiniSwitch label="Inbox" on={inbox} onChange={(v) => patch({ inbox: v })} />
          <MiniSwitch label="WhatsApp" on={whatsapp} onChange={(v) => patch({ whatsapp: v })} />
        </div>
      </Section>
      <Section label="Wait up to">
        <Select label="Wait up to" value={wait} onChange={(v) => patch({ wait: v })} options={['15 minutes', '1 hour', '4 hours', '1 day'].map((n) => ({ id: n, name: n }))} />
      </Section>
      <Section label="If nobody answers">
        <Select
          label="If nobody answers"
          value={timeout}
          onChange={(v) => patch({ onTimeout: v })}
          options={[
            { id: 'remind', name: 'Remind me, then wait again' },
            { id: 'skip', name: 'Skip this branch' },
            { id: 'cancel', name: 'Cancel the run' },
          ]}
        />
      </Section>
    </>
  )
}

function ConnectorBody({ flowId, node }: { flowId: string; node: FlowNode }) {
  const { updateNode } = useFlowStore()
  const cfg = node.config ?? {}
  const channel = (cfg.channel as string | undefined) ?? (node.app === 'slack' ? '#oncall' : '#engineering')
  const action = (cfg.action as 'send' | 'thread' | undefined) ?? 'send'
  const patch = (p: Record<string, unknown>) => updateNode(flowId, node.id, { config: { ...cfg, ...p } })
  return (
    <>
      <Section label="Action">
        <Select label="Action" value={action} onChange={(v) => patch({ action: v })} options={[{ id: 'send', name: 'Send a message' }, { id: 'thread', name: 'Reply in thread' }]} />
      </Section>
      <Section label="Channel">
        <TextInput label="Channel" value={channel} onChange={(v) => patch({ channel: v })} />
      </Section>
      <Section label="Message" hint="type / for inputs">
        <div className="rounded-base bg-surface px-[10px] pt-[8px] pb-[9px] text-[12.5px] leading-[22px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong">
          Deploy failed: <Token>ReadLogs.summary</Token> Cause: <Token>ReadLogs.cause</Token>
          {node.app === 'slack' && (
            <>
              {' '}
              PR: <Token>DraftFix.pr_url</Token>
            </>
          )}
        </div>
      </Section>
      <Note>No AI here — free to run</Note>
    </>
  )
}

// ── Inspector ────────────────────────────────────────────────────────────────

/** Right column (320px): the selected step's settings, plus "Test this step". */
export function Inspector({ flowId }: { flowId: string }) {
  const f = useFlow(flowId)
  const { updateNode } = useFlowStore()
  const node = f.graph.nodes.find((n) => n.id === f.selected)
  const [test, setTest] = useState<{ id: string; state: 'running' | 'done' } | null>(null)
  const renaming = f.renamingId === node?.id && Boolean(node)
  const setRenaming = (on: boolean) => useFlowStore.getState().setRenaming(flowId, on && node ? node.id : null)

  if (!node) {
    return (
      <aside aria-label="Step settings" className="flex w-[320px] shrink-0 flex-col items-center justify-center gap-[6px] px-[24px] text-center shadow-[inset_1px_0_0_var(--color-line-strong)]">
        <p className="m-0 text-[13px] font-semibold text-ink">Nothing selected</p>
        <p className="m-0 text-[12.5px] text-muted">Click a step to change it, or drag one in from the left.</p>
      </aside>
    )
  }

  const { icon, tone } = nodeGlyph(node)
  const AppIcon = node.app && node.kind === 'connector' ? APP_ICON[node.app] : null
  const testing = test?.id === node.id ? test.state : null
  const output = node.id === 'read-logs' ? RUN_DETAIL.r214.steps[1].output : undefined

  function runStepTest() {
    const id = node!.id
    setTest({ id, state: 'running' })
    setTimeout(() => setTest((t) => (t?.id === id ? { id, state: 'done' } : t)), 900)
  }

  return (
    <aside aria-label="Step settings" className="flex w-[320px] shrink-0 flex-col shadow-[inset_1px_0_0_var(--color-line-strong)]">
      <div className="flex min-h-0 flex-1 flex-col gap-[14px] overflow-y-auto px-[16px] pt-[14px] pb-[16px]">
        <div className="flex items-center gap-[10px]">
          {AppIcon ? <StepTile icon={AppIcon} tone="neutral" size={26} /> : <StepTile icon={icon} tone={tone} size={26} />}
          <div className="flex min-w-0 flex-1 flex-col">
            <span className="text-[11px] font-medium tracking-[0.5px] text-muted">{KIND_NAME[node.kind]}</span>
            {renaming ? (
              <input
                autoFocus
                aria-label="Step name"
                defaultValue={node.title}
                onBlur={(e) => {
                  if (e.target.value.trim()) updateNode(flowId, node.id, { title: e.target.value.trim() })
                  setRenaming(false)
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
                  if (e.key === 'Escape') setRenaming(false)
                }}
                className="-mx-[4px] h-[22px] rounded-xs bg-surface px-[4px] text-[14px] font-semibold text-ink outline-1 outline-ink"
              />
            ) : (
              <h2 data-testid="detail-panel-label" className="m-0 truncate text-[14px] font-semibold text-ink" onDoubleClick={() => setRenaming(true)}>
                {node.title}
              </h2>
            )}
          </div>
          <MoreMenu
            label="Step actions"
            items={stepMenu(flowId, node, { inInspector: true, onTest: runStepTest })}
            size={26}
            className="-mr-[6px] self-start rounded-sm"
          />
        </div>

        {node.kind === 'ai' && <AiBody flowId={flowId} node={node} />}
        {node.kind === 'trigger' && <TriggerBody flowId={flowId} node={node} />}
        {node.kind === 'if' && <IfBody flowId={flowId} node={node} />}
        {node.kind === 'approval' && <ApprovalBody flowId={flowId} node={node} />}
        {node.kind === 'connector' && <ConnectorBody flowId={flowId} node={node} />}

        {testing === 'done' && (
          <div role="status" className="flex flex-col gap-[6px] rounded-base bg-ok-tint p-[10px] outline-1 -outline-offset-1 outline-ok-line">
            <span className="flex items-center gap-[6px] text-[12.5px] font-medium text-ok">
              <Check size={13} aria-hidden />
              Step passed with last run’s data · {node.last && node.last !== 'waits' ? node.last : '0.4s'}
            </span>
            {output ? (
              output.map(([k, v]) => (
                <span key={k} className="flex gap-[8px] text-[12px]">
                  <span className="w-[56px] shrink-0 font-mono text-[11px] text-muted">{k}</span>
                  <span className="text-ink-2">{v}</span>
                </span>
              ))
            ) : (
              <span className="text-[12px] text-ink-2">Nothing was sent — test runs never touch your apps.</span>
            )}
          </div>
        )}
      </div>
      <div className="px-[16px] pt-[8px] pb-[13px]">
        <button
          type="button"
          onClick={runStepTest}
          disabled={testing === 'running'}
          className="flex h-[30px] w-full items-center justify-center gap-[7px] rounded-base bg-surface text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft disabled:text-muted"
        >
          {testing === 'running' ? <Loader2 size={14} aria-hidden className="animate-spin" /> : <FlaskConical size={14} aria-hidden className="text-ink-2" />}
          {testing === 'running' ? 'Testing this step…' : 'Test this step with last run’s data'}
        </button>
      </div>
    </aside>
  )
}

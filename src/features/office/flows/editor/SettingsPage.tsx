import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import * as Dropdown from '@radix-ui/react-dropdown-menu'
import { Bell, Check, Plus, X, ChevronsUpDown, Copy, Gauge, History, Pause, Play, Settings2, ShieldCheck, Trash2, TriangleAlert, Zap } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import type { HelperArea } from '../../../../core/domain/types'
import { useChannels, useFlow as useFlowQuery, useDeleteFlow, useDuplicateFlow } from '../../../../app/queries'
import { notify } from '../../../../ui/ds/Toaster'
import { Mascot } from '../../../../ui/ds/Mascot'
import { menuItemClass, menuSurface } from '../../../../ui/ds/Menu'
import { AreaTile } from '../../../shell/LookControls'
import { Box, Chip, DialogCard, Group, PenButton, Row, SaveBar, Scrim, lineBottom } from '../../../control-panel/ControlPanelShared'
import { SPENT_THIS_MONTH, VERSIONS } from './data'
import type { FlowSettings, OverlapPolicy } from './data'
import { EditorFrame } from './EditorFrame'
import { useFlow, useFlowStore } from './store'

const initials = (n: string) => n.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase()

// ── Controls ─────────────────────────────────────────────────────────────────

function Switch({ on, onChange, label }: { on: boolean; onChange: (on: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-[20px] w-[34px] shrink-0 rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink focus-visible:ring-offset-2 ${on ? 'bg-primary' : 'bg-wire-strong'}`}
    >
      <span className={`absolute top-[2px] size-[16px] rounded-full bg-surface shadow-[0_1px_2px_#0C0A0933] transition-transform ${on ? 'translate-x-[16px]' : 'translate-x-[2px]'}`} />
    </button>
  )
}

const field =
  'h-[34px] rounded-base bg-surface px-[11px] text-[13.5px] text-ink outline-1 -outline-offset-1 outline-line-strong placeholder:text-faint focus:outline-ink'

function Affix({ value, onChange, label, prefix, suffix, width = 120 }: { value: string; onChange: (v: string) => void; label: string; prefix?: string; suffix?: string; width?: number }) {
  return (
    <label className="flex h-[34px] items-center gap-[4px] rounded-base bg-surface px-[11px] outline-1 -outline-offset-1 outline-line-strong focus-within:outline-ink" style={{ width }}>
      {prefix && <span className="text-[13.5px] text-muted">{prefix}</span>}
      <input aria-label={label} value={value} inputMode="decimal" onChange={(e) => onChange(e.target.value)} className="min-w-0 flex-1 bg-transparent text-[13.5px] text-ink tabular-nums outline-none" />
      {suffix && <span className="text-[12.5px] text-muted">{suffix}</span>}
    </label>
  )
}

function Pick<T extends string>({ value, options, onChange, label, width = 180 }: { value: T; options: { id: T; name: string; leading?: ReactNode }[]; onChange: (v: T) => void; label: string; width?: number }) {
  const cur = options.find((o) => o.id === value)
  return (
    <Dropdown.Root>
      <Dropdown.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-[34px] items-center gap-[8px] rounded-base bg-surface px-[11px] text-left outline-1 -outline-offset-1 outline-line-strong hover:bg-soft data-[state=open]:outline-ink"
          style={{ width }}
        >
          {cur?.leading}
          <span className="min-w-0 flex-1 truncate text-[13.5px] text-ink">{cur?.name}</span>
          <ChevronsUpDown size={14} aria-hidden className="text-faint" />
        </button>
      </Dropdown.Trigger>
      <Dropdown.Portal>
        <Dropdown.Content align="end" sideOffset={4} className={`z-50 min-w-[var(--radix-dropdown-menu-trigger-width)] ${menuSurface}`}>
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

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; name: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex h-[32px] items-center gap-[2px] rounded-base bg-app p-[2px]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={o.id === value}
          onClick={() => onChange(o.id)}
          className={`h-[28px] rounded-sm px-[11px] text-[12.5px] ${o.id === value ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_#0C0A0914,0_0_0_1px_var(--color-line)]' : 'text-muted hover:text-ink-2'}`}
        >
          {o.name}
        </button>
      ))}
    </div>
  )
}

// ── Sections ─────────────────────────────────────────────────────────────────

const SECTIONS: { id: string; label: string; icon: LucideIcon }[] = [
  { id: 'general', label: 'General', icon: Settings2 },
  { id: 'trigger', label: 'Trigger & timing', icon: Zap },
  { id: 'limits', label: 'Budget & limits', icon: Gauge },
  { id: 'approvals', label: 'Approvals', icon: ShieldCheck },
  { id: 'notifications', label: 'Notifications', icon: Bell },
  { id: 'versions', label: 'Versions', icon: History },
  { id: 'danger', label: 'Danger zone', icon: TriangleAlert },
]

const HELPERS: { id: HelperArea; name: string }[] = [
  { id: 'ops', name: 'Ops' },
  { id: 'dev', name: 'Dev' },
  { id: 'support', name: 'Support' },
  { id: 'finance', name: 'Finance' },
  { id: 'brand', name: 'Chief' },
]

function Anchor({ id, children }: { id: string; children: ReactNode }) {
  return (
    <div id={`flow-settings-${id}`} data-section={id} className="scroll-mt-[20px]">
      {children}
    </div>
  )
}

/**
 * Flow · Settings — designed in the control-panel language (Group · Box · Row):
 * what the flow is, when it may run, what it may spend, who approves, who hears
 * about it, its versions, and the danger zone. Edits wait for Save.
 */
export function FlowSettingsPage() {
  const { flowId } = useParams({ strict: false }) as { flowId: string }
  const navigate = useNavigate()
  const f = useFlow(flowId)
  const st = useFlowStore()
  const { data: areas = [] } = useChannels()
  const { data: liveFlow } = useFlowQuery(flowId)
  const deleteFlow = useDeleteFlow()
  const duplicateFlow = useDuplicateFlow()
  const v = f.settings

  // Build a CreateFlowInput from the live flow (falls back to the editor graph
  // so duplicate still works offline / before the GET resolves).
  function duplicateBody() {
    return {
      title: v.name,
      trigger: liveFlow?.trigger ?? { kind: 'manual', spec: {} },
      nodes: liveFlow?.nodes ?? f.graph.nodes,
      edges: liveFlow?.edges ?? f.graph.edges,
      areas: liveFlow?.areas ?? (v.areaId ? [v.areaId] : []),
      channelIds: liveFlow?.channelIds,
    }
  }
  const set = (p: Partial<FlowSettings>) => st.setSettings(flowId, p)
  const dirty = JSON.stringify(v) !== JSON.stringify(f.savedSettings)
  const [active, setActive] = useState('general')
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [restored, setRestored] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const scroller = useRef<HTMLDivElement>(null)

  // Highlight the section in view
  useEffect(() => {
    const root = scroller.current
    if (!root || typeof IntersectionObserver === 'undefined') return
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0]
        if (top) setActive((top.target as HTMLElement).dataset.section ?? 'general')
      },
      { root, rootMargin: '0px 0px -70% 0px' },
    )
    root.querySelectorAll('[data-section]').forEach((el) => io.observe(el))
    return () => io.disconnect()
  }, [])

  const budget = Number(v.monthlyBudget) || 0
  const pct = budget > 0 ? Math.min(100, (SPENT_THIS_MONTH / budget) * 100) : 0

  return (
    <EditorFrame
      flowId={flowId}
      tab="settings"
      onTestRun={() => {
        st.startTest(flowId)
        void navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
      }}
    >
      <div className="flex min-w-0 flex-1 flex-col">
        <div ref={scroller} className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto">
          <div className="flex w-full max-w-[920px] items-start gap-[40px] px-[32px]">
            <nav aria-label="Settings sections" className="sticky top-0 flex h-fit w-[180px] shrink-0 flex-col gap-[1px] pt-[28px]">
              {SECTIONS.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  aria-current={active === s.id ? 'true' : undefined}
                  onClick={() => {
                    setActive(s.id)
                    document.getElementById(`flow-settings-${s.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })
                  }}
                  className={`flex h-[30px] items-center gap-[9px] rounded-sm px-[9px] text-left text-[13px] ${
                    active === s.id ? 'bg-hover font-medium text-ink' : 'text-ink-2 hover:bg-soft'
                  } ${s.id === 'danger' ? 'mt-[8px]' : ''}`}
                >
                  <s.icon size={15} aria-hidden className={s.id === 'danger' ? 'text-bad' : active === s.id ? 'text-ink' : 'text-muted'} />
                  {s.label}
                </button>
              ))}
            </nav>

            <div className="flex min-w-0 flex-1 flex-col gap-[28px] pt-[24px] pb-[48px]">
              <div className="flex flex-col gap-[4px]">
                <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink [font-variation-settings:'opsz'_96]">Flow settings</h2>
                <p className="m-0 text-[13px] text-muted">How this flow behaves when nobody is watching. Changes apply to the next run.</p>
              </div>

              <Anchor id="general">
                <Group title="General">
                  <Box pad="14px 14px">
                    <div className="flex flex-col gap-[14px]">
                      <label className="flex flex-col gap-[6px]">
                        <span className="text-[13px] font-medium text-ink-2">Name</span>
                        <input aria-label="Flow name" value={v.name} onChange={(e) => set({ name: e.target.value })} className={field} />
                      </label>
                      <label className="flex flex-col gap-[6px]">
                        <span className="text-[13px] font-medium text-ink-2">What it does</span>
                        <textarea
                          aria-label="Description"
                          rows={3}
                          value={v.description}
                          onChange={(e) => set({ description: e.target.value })}
                          className={`${field} h-auto resize-none py-[8px] leading-[20px]`}
                        />
                        <span className="text-[12px] text-muted">Helpers read this when they suggest changes, so plain words work best.</span>
                      </label>
                    </div>
                  </Box>
                  <Box>
                    <Row title="Area" desc="Runs show up in this area’s Inbox and Office.">
                      <Pick
                        label="Area"
                        value={v.areaId}
                        width={200}
                        onChange={(areaId) => set({ areaId })}
                        options={areas.map((a) => ({ id: a.id, name: a.name, leading: <AreaTile area={a} size={18} /> }))}
                      />
                    </Row>
                    <Row title="Owner" desc="Keeps an eye on the flow and suggests fixes when runs fail." last>
                      <Pick
                        label="Owner"
                        value={v.owner}
                        width={200}
                        onChange={(owner) => set({ owner })}
                        options={HELPERS.map((h) => ({ id: h.id, name: h.name, leading: <Mascot size={18} radius={5} area={h.id} still /> }))}
                      />
                    </Row>
                  </Box>
                </Group>
              </Anchor>

              <Anchor id="trigger">
                <Group title="Trigger & timing" desc="The trigger itself lives on the canvas.">
                  <Box>
                    <Row
                      title="Starts when"
                      desc={
                        <>
                          GitHub · deploy job on <span className="font-mono text-[11.5px]">{v.branches || 'any branch'}</span> ends in failure
                        </>
                      }
                    >
                      <PenButton h={30} fs={13} px={11} onClick={() => void navigate({ to: '/flows/$flowId/canvas', params: { flowId } })}>
                        Edit on canvas
                      </PenButton>
                    </Row>
                    <Row title="Branches" desc="Comma-separated. Leave empty for every branch.">
                      <input aria-label="Branches" value={v.branches} onChange={(e) => set({ branches: e.target.value })} className={`${field} w-[200px] font-mono text-[12.5px]`} />
                    </Row>
                    <Row title="Quiet hours" desc={v.quietHours ? `Runs wait until ${v.quietTo}; approvals don’t ping you.` : 'Runs any time of day.'}>
                      {v.quietHours && (
                        <div className="flex items-center gap-[6px] text-[12.5px] text-muted">
                          <input aria-label="Quiet from" type="time" value={v.quietFrom} onChange={(e) => set({ quietFrom: e.target.value })} className={`${field} w-[96px] px-[8px] text-[13px]`} />
                          to
                          <input aria-label="Quiet until" type="time" value={v.quietTo} onChange={(e) => set({ quietTo: e.target.value })} className={`${field} w-[96px] px-[8px] text-[13px]`} />
                        </div>
                      )}
                      <Switch label="Quiet hours" on={v.quietHours} onChange={(quietHours) => set({ quietHours })} />
                    </Row>
                    <Row title="If it fires while a run is going" desc="Deploys can fail twice in a row." last>
                      <Segmented<OverlapPolicy>
                        label="If it fires while a run is going"
                        value={v.overlap}
                        onChange={(overlap) => set({ overlap })}
                        options={[
                          { id: 'queue', name: 'Queue it' },
                          { id: 'skip', name: 'Skip it' },
                          { id: 'parallel', name: 'Run both' },
                        ]}
                      />
                    </Row>
                  </Box>
                </Group>
              </Anchor>

              <Anchor id="limits">
                <Group title="Budget & limits" desc="A run that hits a limit stops and tells you — it never keeps spending.">
                  <Box>
                    <Row title="Monthly budget" desc={`$${SPENT_THIS_MONTH.toFixed(2)} spent this month · resets Nov 1`}>
                      <Affix label="Monthly budget" prefix="$" value={v.monthlyBudget} onChange={(monthlyBudget) => set({ monthlyBudget })} width={110} />
                    </Row>
                    <div className={`flex flex-col gap-[6px] pt-[2px] pb-[14px] ${lineBottom}`}>
                      <div className="h-[6px] w-full overflow-hidden rounded-full bg-app" role="meter" aria-label="Budget used" aria-valuenow={Math.round(pct)} aria-valuemin={0} aria-valuemax={100}>
                        <div className={`h-full rounded-full ${pct > 85 ? 'bg-bad-solid' : pct > 60 ? 'bg-spark' : 'bg-ok'}`} style={{ width: `${pct}%` }} />
                      </div>
                      <span className="text-[12px] text-muted">
                        {Math.round(pct)}% used · about {Math.max(0, Math.floor((budget - SPENT_THIS_MONTH) / 0.018))} more runs at today’s cost
                      </span>
                    </div>
                    <Row title="Max cost per run" desc="Typical run is ~$0.02.">
                      <Affix label="Max cost per run" prefix="$" value={v.costCap} onChange={(costCap) => set({ costCap })} width={110} />
                    </Row>
                    <Row title="Max steps per run" desc="Counts every step, including retries.">
                      <Affix label="Max steps per run" value={v.maxSteps} suffix="steps" onChange={(maxSteps) => set({ maxSteps })} width={110} />
                    </Row>
                    <Row title="Stop a run after" desc="Waiting for an approval doesn’t count." last>
                      <Pick
                        label="Stop a run after"
                        value={v.runTimeout}
                        width={140}
                        onChange={(runTimeout) => set({ runTimeout })}
                        options={['2 min', '10 min', '30 min', '1 hour'].map((n) => ({ id: n, name: n }))}
                      />
                    </Row>
                  </Box>
                </Group>
              </Anchor>

              <Anchor id="approvals">
                <Group title="Approvals" desc="Steps that need a person before anything changes.">
                  <Box>
                    <Row title="Who can approve" desc="Anyone here can approve from Inbox.">
                      <div className="flex items-center gap-[6px]">
                        {v.approvers.map((a) => (
                          <Chip key={a}>
                            <span
                              className="flex size-[14px] items-center justify-center rounded-full text-[7px] font-semibold text-white"
                              style={{ background: a === 'Dede Kurniawan' ? '#F97316' : '#8B5CF6' }}
                            >
                              {initials(a)}
                            </span>
                            {a === 'Dede Kurniawan' ? 'You' : a.split(' ')[0]}
                            {a !== 'Dede Kurniawan' && (
                              <button type="button" aria-label={`Remove ${a}`} onClick={() => set({ approvers: v.approvers.filter((x) => x !== a) })} className="-mr-[3px] text-faint hover:text-ink">
                                <X size={11} aria-hidden />
                              </button>
                            )}
                          </Chip>
                        ))}
                        <Dropdown.Root>
                          <Dropdown.Trigger asChild>
                            <button
                              type="button"
                              aria-label="Add an approver"
                              className="flex h-[26px] items-center gap-[4px] rounded-sm px-[8px] text-[12.5px] font-medium text-ink-2 outline-1 -outline-offset-1 outline-line-strong outline-dashed hover:bg-soft"
                            >
                              <Plus size={13} aria-hidden />
                              Add
                            </button>
                          </Dropdown.Trigger>
                          <Dropdown.Portal>
                            <Dropdown.Content align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
                              {['Rina Putri', 'Bagus Santoso', 'Sari Wulandari']
                                .filter((n) => !v.approvers.includes(n))
                                .map((n) => (
                                  <Dropdown.Item key={n} className={menuItemClass} onSelect={() => set({ approvers: [...v.approvers, n] })}>
                                    <span className="flex size-[18px] items-center justify-center rounded-full bg-[#8B5CF6] text-[8.5px] font-semibold text-white">{initials(n)}</span>
                                    <span className="flex-1 text-[13px] text-ink">{n}</span>
                                  </Dropdown.Item>
                                ))}
                            </Dropdown.Content>
                          </Dropdown.Portal>
                        </Dropdown.Root>
                      </div>
                    </Row>
                    <Row title="Wait for an answer" desc="Reminds you halfway through.">
                      <Pick
                        label="Wait for an answer"
                        value={v.approvalWait}
                        width={140}
                        onChange={(approvalWait) => set({ approvalWait })}
                        options={['15 minutes', '1 hour', '4 hours', '1 day'].map((n) => ({ id: n, name: n }))}
                      />
                    </Row>
                    <Row title="If nobody answers">
                      <Segmented
                        label="If nobody answers"
                        value={v.onTimeout}
                        onChange={(onTimeout) => set({ onTimeout })}
                        options={[
                          { id: 'remind', name: 'Ask again' },
                          { id: 'skip', name: 'Skip step' },
                          { id: 'cancel', name: 'Cancel run' },
                        ]}
                      />
                    </Row>
                    <Row title="Auto-approve low severity" desc="P2–P3 fixes go ahead without asking. Prod changes always ask." last>
                      <Switch label="Auto-approve low severity" on={v.autoApproveLow} onChange={(autoApproveLow) => set({ autoApproveLow })} />
                    </Row>
                  </Box>
                </Group>
              </Anchor>

              <Anchor id="notifications">
                <Group title="Notifications">
                  <Box>
                    <Row title="A run fails" desc="In Inbox, with the step that broke.">
                      <Switch label="Tell me when a run fails" on={v.notifyFail} onChange={(notifyFail) => set({ notifyFail })} />
                    </Row>
                    <Row title="A run is waiting for me" desc="In Inbox, right away.">
                      <Switch label="Tell me when a run waits" on={v.notifyWaiting} onChange={(notifyWaiting) => set({ notifyWaiting })} />
                    </Row>
                    <Row title="Also on WhatsApp" desc="For approvals and failures only.">
                      <Switch label="Also on WhatsApp" on={v.notifyWhatsApp} onChange={(notifyWhatsApp) => set({ notifyWhatsApp })} />
                    </Row>
                    <Row title="Weekly summary" desc="Mondays · runs, cost, and what Ops would change." last>
                      <Switch label="Weekly summary" on={v.weeklySummary} onChange={(weeklySummary) => set({ weeklySummary })} />
                    </Row>
                  </Box>
                </Group>
              </Anchor>

              <Anchor id="versions">
                <Group title="Versions" desc="Every publish is kept. Restoring puts that version on the canvas as unpublished changes.">
                  <Box>
                    {VERSIONS.map((ver, i) => (
                      <Row
                        key={ver.id}
                        last={i === VERSIONS.length - 1}
                        leading={<span className="w-[26px] shrink-0 font-mono text-[12px] text-muted">{ver.label}</span>}
                        title={ver.note}
                        desc={`${ver.when} · ${ver.by}`}
                      >
                        {i === 0 ? (
                          <Chip tone="ok">{f.publishedAt ? 'Live' : 'Live'}</Chip>
                        ) : restored === ver.id ? (
                          <Chip tone="info">On canvas</Chip>
                        ) : (
                          <PenButton
                            h={28}
                            fs={12.5}
                            px={10}
                            onClick={() => {
                              st.restoreVersion(flowId)
                              setRestored(ver.id)
                            }}
                          >
                            Restore
                          </PenButton>
                        )}
                      </Row>
                    ))}
                  </Box>
                </Group>
              </Anchor>

              <Anchor id="danger">
                <Group title="Danger zone">
                  <Box className="!outline-bad-line">
                    <Row title={f.enabled ? 'Pause this flow' : 'Resume this flow'} desc={f.enabled ? 'Stops new runs. Runs in progress finish.' : 'Paused — new deploy failures are ignored.'}>
                      <PenButton h={30} fs={13} px={11} icon={f.enabled ? Pause : Play} iconSize={14} onClick={() => st.setEnabled(flowId, !f.enabled)}>
                        {f.enabled ? 'Pause' : 'Resume'}
                      </PenButton>
                    </Row>
                    <Row title="Duplicate" desc="A copy starts as an unpublished draft.">
                      <PenButton
                        h={30}
                        fs={13}
                        px={11}
                        icon={copied ? Check : Copy}
                        iconSize={14}
                        onClick={() =>
                          duplicateFlow.mutate(duplicateBody(), {
                            onSuccess: () => { setCopied(true); notify('Copied to drafts') },
                          })
                        }
                      >
                        {copied ? 'Copied to drafts' : 'Duplicate'}
                      </PenButton>
                    </Row>
                    <Row title="Delete this flow" desc="Removes the flow and its run history. Can’t be undone." last>
                      <PenButton variant="danger" h={30} fs={13} px={11} icon={Trash2} iconSize={14} onClick={() => setConfirmDelete(true)}>
                        Delete
                      </PenButton>
                    </Row>
                  </Box>
                </Group>
              </Anchor>
            </div>
          </div>
        </div>
        {dirty && <SaveBar dirty onSave={() => st.saveSettings(flowId)} onDiscard={() => st.discardSettings(flowId)} />}
      </div>

      {confirmDelete && (
        <Scrim onClose={() => setConfirmDelete(false)}>
          <DialogCard
            width={420}
            title={`Delete “${v.name}”?`}
            icon={Trash2}
            label="Delete flow"
            onClose={() => setConfirmDelete(false)}
            footer={
              <>
                <PenButton onClick={() => setConfirmDelete(false)}>Keep it</PenButton>
                <PenButton
                  variant="danger-solid"
                  onClick={() =>
                    deleteFlow.mutate(flowId, {
                      onSuccess: () => {
                        setConfirmDelete(false)
                        notify('Flow deleted')
                        void navigate({ to: '/flows' })
                      },
                    })
                  }
                >
                  Delete flow
                </PenButton>
              </>
            }
          >
            <p className="m-0 text-[13.5px] text-ink-2">
              The flow and its run history go away for everyone. Steps that are running now are cancelled.
            </p>
          </DialogCard>
        </Scrim>
      )}
    </EditorFrame>
  )
}

import type { ReactNode } from 'react'
import { ArrowLeft, Check, Play, Power, Upload } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { AreaChip } from '../../../../ui/ds/AreaChip'
import { useChannel } from '../../../../app/queries'
import { OFFICE_FLOWS } from '../data'
import { useFlow, useFlowStore } from './store'

export type EditorTab = 'canvas' | 'runs' | 'settings'

/** Flow title for the editor crumb. */
export function useFlowTitle(flowId: string) {
  const f = useFlow(flowId)
  const fallback = OFFICE_FLOWS.find((x) => x.id === flowId)?.title ?? 'Untitled flow'
  return f.settings.name || fallback
}

/** pen 34px dark switch with "On" label. */
export function OnSwitch({ on, onChange, label = 'Flow on' }: { on: boolean; onChange: (on: boolean) => void; label?: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onChange(!on)}
      className="group flex items-center gap-[6px] rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ink"
    >
      <span className={`relative inline-flex h-[16px] w-[28px] shrink-0 rounded-full transition-colors ${on ? 'bg-primary' : 'bg-wire-strong'}`}>
        <span
          className={`absolute top-[2px] size-[12px] rounded-full bg-surface transition-transform ${on ? 'translate-x-[14px]' : 'translate-x-[2px]'}`}
        />
      </span>
      <span className="text-[12.5px] text-ink-2">{on ? 'On' : 'Off'}</span>
    </button>
  )
}

const TABS: { id: EditorTab; label: string }[] = [
  { id: 'canvas', label: 'Canvas' },
  { id: 'runs', label: 'Runs' },
  { id: 'settings', label: 'Settings' },
]

/**
 * Flow editor card: inset (6px, line-strong outline, radius 12) holding the
 * 48px topbar — crumb · area · on switch | Canvas/Runs/Settings | cost · Test run · Publish.
 */
export function EditorFrame({
  flowId,
  tab,
  draft = false,
  onTestRun,
  children,
}: {
  flowId: string
  tab: EditorTab
  /** Draft from Suggested: "Draft · not running" chip + Turn on flow. */
  draft?: boolean
  onTestRun?: () => void
  children: ReactNode
}) {
  const navigate = useNavigate()
  const title = useFlowTitle(flowId)
  const f = useFlow(flowId)
  const { setEnabled, publish, setDraft, startTest } = useFlowStore()
  const { data: area } = useChannel(f.settings.areaId)

  const go = (t: EditorTab) => {
    if (t === tab) return
    if (t === 'canvas') void navigate({ to: draft ? '/flows/$flowId/draft' : '/flows/$flowId/canvas', params: { flowId } })
    else if (t === 'runs') void navigate({ to: '/flows/$flowId/runs', params: { flowId } })
    else void navigate({ to: '/flows/$flowId/settings', params: { flowId } })
  }

  return (
    <main aria-label={`${title} editor`} className="flex h-full min-w-0 flex-1 py-[6px] pr-[6px]">
      <div className="flex min-w-0 flex-1 flex-col overflow-hidden rounded-lg bg-surface outline-1 -outline-offset-1 outline-line-strong">
        <header className="flex h-[48px] w-full shrink-0 items-center gap-[10px] px-[14px] shadow-[inset_0_-1px_0_var(--color-line)]">
          <div className="flex min-w-0 items-center gap-[10px]">
            <button
              type="button"
              aria-label="Back to Flows"
              onClick={() => void navigate({ to: '/flows' })}
              className="flex items-center gap-[6px] rounded-sm px-[2px] text-[13px] text-muted outline-none hover:text-ink-2 focus-visible:ring-2 focus-visible:ring-ink"
            >
              <ArrowLeft size={14} aria-hidden />
              Flows
            </button>
            <span className="text-[13px] text-faint" aria-hidden>
              /
            </span>
            <h1 className="m-0 truncate text-[13.5px] font-semibold text-ink">{title}</h1>
            <AreaChip accent={area?.accent ?? 'dev'} label={area?.name ?? 'Engineering'} area={area ?? undefined} />
            {draft ? (
              <span className="inline-flex h-[18px] items-center rounded-xs bg-[#E0E7FF] px-[6px] text-[11.5px] font-medium text-[#4338CA]">
                Draft · not running
              </span>
            ) : (
              <span className="ml-[6px]">
                <OnSwitch on={f.enabled} onChange={(on) => setEnabled(flowId, on)} />
              </span>
            )}
          </div>
          <div className="h-px min-w-0 flex-1" />
          <nav aria-label="Flow views" className="flex h-[30px] items-center gap-[2px] rounded-base bg-app p-[2px]">
            {TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                aria-current={t.id === tab ? 'page' : undefined}
                onClick={() => go(t.id)}
                className={`h-[26px] rounded-sm px-[10px] text-[12.5px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ink ${
                  t.id === tab
                    ? 'bg-surface font-medium text-ink shadow-[0_1px_2px_#0C0A0914,0_0_0_1px_var(--color-line)]'
                    : 'text-muted hover:text-ink-2'
                }`}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div className="h-px min-w-0 flex-1" />
          <div className="flex items-center gap-[10px]">
            <span className="text-[12.5px] whitespace-nowrap text-muted">{draft ? 'est. ~$0.02 a run' : '~$0.02 a run'}</span>
            <button
              type="button"
              onClick={
                onTestRun ??
                (() => {
                  startTest(flowId)
                  void navigate({ to: draft ? '/flows/$flowId/draft' : '/flows/$flowId/canvas', params: { flowId } })
                })
              }
              className="inline-flex h-[28px] items-center gap-[6px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft focus-visible:outline-ink"
            >
              <Play size={14} aria-hidden className="text-ink-2" />
              Test run
            </button>
            {draft ? (
              <button
                type="button"
                onClick={() => {
                  setDraft(flowId, 'on')
                  void navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
                }}
                className="inline-flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[10px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover"
              >
                <Power size={14} aria-hidden />
                Turn on flow
              </button>
            ) : (
              <button
                type="button"
                disabled={!f.dirty}
                onClick={() => publish(flowId)}
                className="inline-flex h-[28px] items-center gap-[6px] rounded-btn bg-primary px-[10px] text-[12.5px] font-medium text-primary-ink hover:bg-primary-hover disabled:bg-surface disabled:text-muted disabled:outline-1 disabled:-outline-offset-1 disabled:outline-line-strong"
              >
                {f.dirty ? <Upload size={14} aria-hidden /> : <Check size={14} aria-hidden />}
                {f.dirty ? 'Publish changes' : 'Published'}
              </button>
            )}
          </div>
        </header>
        <div className="relative flex min-h-0 flex-1">{children}</div>
      </div>
    </main>
  )
}

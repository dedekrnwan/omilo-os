import { useState } from 'react'
import { useParams } from '@tanstack/react-router'
import { Link } from '@tanstack/react-router'
import { ArrowLeft, ChevronDown, Ellipsis, Pause } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Button } from '../../ui/ds/Button'
import { Inset } from '../../ui/ds/Frame'
import { menuSurface } from '../../ui/ds/Menu'
import type { HelperArea } from '../../core/domain/types'
import { getHelper } from './teamData'
import type { HelperTab, HelperStatus } from './teamData'
import { JobTab } from './tabs/JobTab'
import { ChannelsTab } from './tabs/ChannelsTab'
import { BehaviorTab } from './tabs/BehaviorTab'
import { ToolsTab } from './tabs/ToolsTab'
import { SkillsTab } from './tabs/SkillsTab'
import { ProfileTab } from './tabs/ProfileTab'
import { PlaybookTab } from './tabs/PlaybookTab'

// ── Status chip ───────────────────────────────────────────────────────────────

const STATUS_STYLE: Record<HelperStatus, { bg: string; ink: string }> = {
  'Working':            { bg: 'var(--color-ok-tint)',     ink: 'var(--color-ok)' },
  'Needs you':          { bg: 'var(--color-warn-tint)',   ink: 'var(--color-warn)' },
  'Caught up':          { bg: '#E0F2FE',                  ink: '#0369A1' },
  'Idle':               { bg: 'var(--color-line-strong)', ink: 'var(--color-muted)' },
  'Always on':          { bg: 'var(--color-ok-tint)',     ink: 'var(--color-ok)' },
  'Planning next week': { bg: '#E0E7FF',                  ink: '#4338CA' },
}

// ── Model menu ────────────────────────────────────────────────────────────────

function ModelMenu({ name, model }: { name: string; model: string }) {
  const [open, setOpen] = useState(false)
  const [selected, setSelected] = useState(model)
  const models = ['Opus 5.5', 'Sonnet 5.5', 'Haiku 5.5']

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex h-[22px] items-center gap-[4px] rounded-pill bg-soft px-[8px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
      >
        <span className="text-[10px]">⚙</span>
        {selected}
        <ChevronDown size={11} aria-hidden className="text-muted" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className={`absolute top-[28px] left-0 z-50 w-[200px] ${menuSurface}`}>
            <div className="px-[10px] pt-[8px] pb-[4px] text-[10.5px] font-medium tracking-[0.55px] text-muted uppercase">
              Model for {name}
            </div>
            {models.map((m) => (
              <button
                key={m}
                type="button"
                onClick={() => { setSelected(m); setOpen(false) }}
                className="flex h-[30px] w-full items-center gap-[6px] rounded-sm px-[8px] text-[12.5px] text-left hover:bg-hover transition-colors"
              >
                {selected === m && <span className="text-ok">✓</span>}
                <span className={`flex-1 ${selected === m ? 'text-ink font-medium' : 'text-ink-2'}`}>{m}</span>
                {m === 'Sonnet 5.5' && <span className="text-[10.5px] text-faint">~3× cheaper</span>}
                {m === 'Haiku 5.5' && <span className="text-[10.5px] text-faint">fastest</span>}
              </button>
            ))}
            <div className="border-t border-line mx-[4px] my-[4px]" />
            <button type="button" className="flex h-[30px] w-full items-center gap-[6px] rounded-sm px-[8px] text-[12.5px] text-muted text-left hover:bg-hover transition-colors">
              Use company default
            </button>
            <button type="button" className="flex h-[30px] w-full items-center gap-[6px] rounded-sm px-[8px] text-[12.5px] text-muted text-left hover:bg-hover transition-colors">
              Manage AI accounts
            </button>
          </div>
        </>
      )}
    </div>
  )
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

const ALL_TABS: { id: HelperTab; label: string; badge?: (channels: number, skills: number) => string | null }[] = [
  { id: 'Job', label: 'Job' },
  { id: 'Channels', label: 'Channels', badge: (ch) => ch > 0 ? String(ch) : null },
  { id: 'Behavior', label: 'Behavior' },
  { id: 'Tools', label: 'Tools', badge: (_, sk) => sk > 0 ? String(sk) : null },
  { id: 'Skills', label: 'Skills', badge: (_, sk) => sk > 0 ? `${sk} ›` : null },
  { id: 'Profile', label: 'Profile' },
]

// ── HelperDetailPage ──────────────────────────────────────────────────────────

function HelperDetailPage({ helperId }: { helperId: string }) {
  const helper = getHelper(helperId)
  const [activeTab, setActiveTab] = useState<HelperTab>('Job')
  const [playbookOpen, setPlaybookOpen] = useState(false)

  if (!helper) {
    return (
      <Inset label="Team">
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          Helper not found.{' '}
          <Link to="/team" className="text-link hover:underline ml-[4px]">
            Back to Team
          </Link>
        </div>
      </Inset>
    )
  }

  const st = STATUS_STYLE[helper.status]

  function renderTab() {
    if (playbookOpen) return <PlaybookTab helper={helper!} />
    switch (activeTab) {
      case 'Job':      return <JobTab helper={helper!} />
      case 'Channels': return <ChannelsTab helper={helper!} />
      case 'Behavior': return <BehaviorTab helper={helper!} />
      case 'Tools':    return <ToolsTab helper={helper!} />
      case 'Skills':   return <SkillsTab helper={helper!} />
      case 'Profile':  return <ProfileTab helper={helper!} />
    }
  }

  // Tab badge for Channels, Tools and Skills
  function tabBadge(tab: HelperTab): string | null {
    // Channels shows connected / total (pen "2/5")
    if (tab === 'Channels') return helper!.channelCount > 0 ? `${helper!.channelCount}/${helper!.channels.length}` : null
    if (tab === 'Tools') return helper!.tools.filter(t => !t.builtIn).length > 0
      ? String(helper!.tools.filter(t => !t.builtIn).length)
      : null
    if (tab === 'Skills') return helper!.skills.length > 0 ? String(helper!.skills.length) : null
    return null
  }

  return (
    <Inset label={`Team · ${helper.name}`}>
      {/* Topbar */}
      <header className="flex h-[44px] w-full shrink-0 items-center gap-[8px] border-b border-line px-[16px]">
        <Link
          to="/team"
          className="flex items-center gap-[4px] text-[12.5px] text-muted hover:text-ink transition-colors"
        >
          <ArrowLeft size={13} aria-hidden />
          Team
        </Link>
        <div className="h-px flex-1" />
        <Button variant="secondary" height={28} icon={Pause}>
          Pause
        </Button>
        <button
          type="button"
          aria-label="More options"
          className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover transition-colors"
        >
          <Ellipsis size={15} aria-hidden />
        </button>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {/* Hero */}
        <div className="flex flex-col items-center gap-[10px] px-[24px] pt-[28px] pb-[20px]">
          <Mascot size={72} radius={18} area={helper.area as HelperArea} title={helper.name} />
          <h2 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
            {helper.name}
          </h2>

          {/* Meta pills row */}
          <div className="flex flex-wrap items-center justify-center gap-[6px]">
            <button
              type="button"
              className="flex h-[22px] items-center gap-[4px] rounded-pill bg-soft px-[8px] text-[11.5px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
            >
              <span className="text-[10px]">⬡</span>
              Role · {helper.roleLabel}
              <ChevronDown size={11} aria-hidden className="text-muted" />
            </button>

            <ModelMenu name={helper.name} model={helper.model} />

            <span
              className="inline-flex h-[22px] items-center rounded-pill px-[8px] text-[11.5px] font-medium"
              style={{ background: st.bg, color: st.ink }}
            >
              {helper.status}
            </span>
          </div>

          <p className="m-0 text-center text-[12.5px] text-muted">{helper.statsLine}</p>
        </div>

        {/* Tabs — centered pill row (pen XB1kX) */}
        <div className="flex justify-center px-[24px] pb-[4px]">
          <div className="flex items-center gap-[2px]">
            {ALL_TABS.map(({ id, label }) => {
              const badge = tabBadge(id)
              const on = activeTab === id && !playbookOpen
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => { setActiveTab(id); setPlaybookOpen(false) }}
                  aria-current={on ? 'true' : undefined}
                  className={`flex h-[30px] items-center gap-[5px] rounded-pill px-[12px] text-[13px] transition-colors ${
                    on ? 'bg-soft font-medium text-ink outline-1 -outline-offset-1 outline-line-strong' : 'text-muted hover:bg-hover hover:text-ink'
                  }`}
                >
                  {label}
                  {badge && <span className="text-[11.5px] text-faint">{badge}</span>}
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content — centered column */}
        <div className="flex-1 px-[24px] py-[20px]">
          <div className="mx-auto w-full max-w-[760px]">
            {renderTab()}
          </div>
        </div>

        {/* Playbook floating link — shown on Job tab when helper has playbook */}
        {activeTab === 'Job' && helper.workingFiles.some(f => f.name === 'PLAYBOOK.md') && (
          <div className="sticky bottom-0 flex justify-center pb-[16px]">
            <button
              type="button"
              onClick={() => { setPlaybookOpen(true) }}
              className="flex items-center gap-[6px] rounded-pill bg-surface px-[14px] py-[7px] text-[12.5px] font-medium text-ink shadow-[0_4px_12px_#0C0A091F] outline-1 -outline-offset-1 outline-line-strong hover:bg-soft transition-colors"
            >
              📋 PLAYBOOK.md · open
            </button>
          </div>
        )}
      </div>
    </Inset>
  )
}

// ── HelperDetail route component ──────────────────────────────────────────────

/**
 * Route component for /team/$helperId.
 * No sidebar — full-width Inset for the detail view.
 */
export function HelperDetail() {
  const params = useParams({ strict: false })
  const helperId = params.helperId ?? ''
  return <HelperDetailPage helperId={helperId} />
}

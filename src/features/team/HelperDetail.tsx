import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams, useSearch } from '@tanstack/react-router'
import { ArrowLeft, ArrowUpRight, Building2, Check, ChevronDown, Cpu, Ellipsis, Feather, Pause, Play, UserMinus, Zap } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { Inset } from '../../ui/ds/Frame'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../ui/ds/Menu'
import { notify } from '../../ui/ds/Toaster'
import {
  useCompanySettings,
  useHelperDetail,
  useHelperFiles,
  useHelpers,
  useRetireHelper,
  useUpdateHelperEverywhere,
} from '../../app/queries'
import { useSession } from '../../app/session'
import type { HelperRecord, HelperTab, WorkingFile } from './teamData'
import { MODEL_IDS, buildHelperRecord, companyDefaultModel } from './model'
import { StatusChip, TeamTopbar } from './StatusChip'
import { Btn, IconBtn } from './ui'
import { JobTab } from './tabs/JobTab'
import { ChannelsTab } from './tabs/ChannelsTab'
import { BehaviorTab } from './tabs/BehaviorTab'
import { ToolsTab } from './tabs/ToolsTab'
import { SkillsTab } from './tabs/SkillsTab'
import { ProfileTab } from './tabs/ProfileTab'
import { PlaybookDrawer } from './tabs/PlaybookTab'
import { ConnectTelegramDialog } from './channel-dialogs/ConnectTelegramDialog'
import { ConnectWhatsAppDialog } from './channel-dialogs/ConnectWhatsAppDialog'
import { ConnectEmailDialog } from './channel-dialogs/ConnectEmailDialog'
import { BrowseSkillsDialog } from './BrowseSkillsDialog'
import { LetGoDialog } from './LetGoDialog'

/**
 * Overlay states of a helper page, reachable from the UI and via `?state=`:
 * model (pen dcvvQ) · playbook (vDIEL) · telegram (GwcDV) · whatsapp (pyuhG) ·
 * email (WruOn) · browse (uvNJ3) · letgo (HX7PZ).
 */
export type HelperState = 'model' | 'playbook' | 'telegram' | 'whatsapp' | 'email' | 'browse' | 'letgo'

const TABS: { id: HelperTab; label: string; count?: keyof HelperRecord['counts'] }[] = [
  { id: 'job', label: 'Job' },
  { id: 'channels', label: 'Channels', count: 'channels' },
  { id: 'behavior', label: 'Behavior' },
  { id: 'tools', label: 'Tools', count: 'tools' },
  { id: 'skills', label: 'Skills', count: 'skills' },
  { id: 'profile', label: 'Profile' },
]

// ── Hero pills ────────────────────────────────────────────────────────────────

function Pill({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: typeof Cpu
  label: string
  active?: boolean
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={active}
      className={`flex items-center gap-[6px] rounded-base px-[10px] py-[5px] transition-colors hover:bg-soft ${
        active ? 'outline-[1.5px] -outline-offset-[1.5px] outline-ink' : 'outline-1 -outline-offset-1 outline-line'
      }`}
    >
      <Icon size={13} aria-hidden className="text-muted" />
      <span className="text-[13px] text-ink-2">{label}</span>
      <ChevronDown size={13} aria-hidden className="text-muted" />
    </button>
  )
}

const MODEL_HINT: Record<string, string | undefined> = { 'Sonnet 5.5': '~3× cheaper', 'Haiku 5.5': 'Fastest' }
const MODELS = MODEL_IDS.map((id) => ({ id, icon: id === 'Haiku 5.5' ? Feather : Zap, hint: MODEL_HINT[id] }))

/** Model menu — pen dcvvQ Popover TTWx4 (260 wide, 6px under the pill). */
function ModelMenu({
  helper,
  currentModel,
  onPick,
  onClose,
}: {
  helper: HelperRecord
  currentModel: string
  onPick: (m: string) => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const [hover, setHover] = useState<string | null>(null)
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
  const hl = hover ?? currentModel
  return (
    <div
      ref={ref}
      role="menu"
      aria-label={`Model for ${helper.name}`}
      className={`absolute top-[calc(100%+6px)] left-0 z-40 flex w-[260px] flex-col ${menuSurface}`}
      onPointerLeave={() => setHover(null)}
    >
      <div className="px-[10px] pt-[6px] pb-[2px] text-[11px] font-medium tracking-[0.55px] text-muted">
        {`MODEL FOR ${helper.name.toUpperCase()}`}
      </div>
      {MODELS.map((m) => (
        <button
          key={m.id}
          type="button"
          role="menuitemradio"
          aria-checked={currentModel === m.id}
          onPointerEnter={() => setHover(m.id)}
          onClick={() => { onPick(m.id); onClose() }}
          className={`${menuItemClass} ${hl === m.id ? 'bg-hover' : ''}`}
        >
          <MenuItemBody icon={currentModel === m.id ? Check : m.icon} label={m.id} hint={m.hint} />
        </button>
      ))}
      <MenuSeparatorLine />
      <button type="button" role="menuitem" className={menuItemClass} onClick={() => { onPick(''); onClose() }}>
        <MenuItemBody icon={Building2} label="Use company default" />
      </button>
      <button
        type="button"
        role="menuitem"
        className={menuItemClass}
        onClick={() => {
          onClose()
          void navigate({ to: '/control-panel/$section', params: { section: 'ai-accounts' } })
        }}
      >
        <MenuItemBody icon={ArrowUpRight} label="Manage AI accounts" />
      </button>
    </div>
  )
}

/** Role selector menu — opens below the Role pill, local state only. */
const ROLE_OPTIONS = [
  'Chief of Staff',
  'Dev',
  'Growth',
  'Sales',
  'Finance',
  'Support',
  'Ops',
  'Custom',
] as const

function RoleMenu({
  currentRole,
  onPick,
  onClose,
}: {
  currentRole: string
  onPick: (r: string) => void
  onClose: () => void
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
      aria-label="Select role"
      className={`absolute top-[calc(100%+6px)] left-0 z-40 flex w-[220px] flex-col ${menuSurface}`}
    >
      <div className="px-[10px] pt-[6px] pb-[2px] text-[11px] font-medium tracking-[0.55px] text-muted">ROLE</div>
      {ROLE_OPTIONS.map((r) => (
        <button
          key={r}
          type="button"
          role="menuitemradio"
          aria-checked={currentRole === r}
          onClick={() => { onPick(r); onClose() }}
          className={`${menuItemClass} ${currentRole === r ? 'bg-hover' : ''}`}
        >
          <MenuItemBody icon={currentRole === r ? Check : undefined} label={r} />
        </button>
      ))}
    </div>
  )
}

/** More-options menu for a helper page. */
function MoreMenu({
  helperName,
  paused,
  onTogglePause,
  onLetGo,
  onClose,
}: {
  helperName: string
  paused: boolean
  onTogglePause: () => void
  /** Absent for the Chief, who can't be let go. */
  onLetGo?: () => void
  onClose: () => void
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
      aria-label="More actions"
      className={`absolute top-[calc(100%+4px)] right-0 z-40 flex w-[200px] flex-col ${menuSurface}`}
    >
      <button type="button" role="menuitem" className={menuItemClass} onClick={() => { onTogglePause(); onClose() }}>
        <MenuItemBody icon={paused ? Play : Pause} label={paused ? `Resume ${helperName}` : `Pause ${helperName}`} />
      </button>
      {onLetGo && (
        <>
          <MenuSeparatorLine />
          <button type="button" role="menuitem" className={menuItemClass} onClick={() => { onLetGo(); onClose() }}>
            <MenuItemBody icon={UserMinus} label={`Let ${helperName} go`} danger />
          </button>
        </>
      )}
    </div>
  )
}

// ── Page ──────────────────────────────────────────────────────────────────────

function HelperDetailPage({ helper }: { helper: HelperRecord }) {
  const search = useSearch({ strict: false }) as { tab?: string; state?: string }
  const navigate = useNavigate()
  const tab = (TABS.some((t) => t.id === search.tab) ? search.tab : 'job') as HelperTab
  const state = search.state as HelperState | undefined
  const go = (next: { tab?: HelperTab; state?: HelperState }) => {
    const s: Record<string, string> = {}
    const t = 'tab' in next ? next.tab : tab
    if (t && t !== 'job') s.tab = t
    if (next.state) s.state = next.state
    void navigate({ to: '/team/$helperId', params: { helperId: helper.id }, search: s as never, replace: true })
  }
  const setState = (st?: HelperState) => go({ state: st })
  const close = () => setState(undefined)

  const updateHelper = useUpdateHelperEverywhere()
  const retire = useRetireHelper()
  const paused = helper.paused
  const isChief = !!helper.helper.isChief
  const [showRoleMenu, setShowRoleMenu] = useState(false)
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [openFile, setOpenFile] = useState<WorkingFile['name']>('PLAYBOOK.md')

  const patch = (input: Parameters<typeof updateHelper.mutate>[0]['input'], ok: string) =>
    updateHelper.mutate(
      { id: helper.id, input },
      { onSuccess: () => notify(ok), onError: () => notify(`Couldn't update ${helper.name}`) },
    )
  const togglePause = () =>
    patch({ status: paused ? 'active' : 'paused' }, paused ? `${helper.name} resumed` : `${helper.name} paused`)
  const letGo = () =>
    retire.mutate(helper.id, {
      onSuccess: () => {
        notify(`${helper.name} let go`)
        void navigate({ to: '/team' })
      },
      onError: () => notify(`Couldn't let ${helper.name} go`),
    })
  const role = helper.helper.role || helper.role
  const model = helper.model

  return (
    <>
      <Inset label={`Team · ${helper.name}`}>
        <TeamTopbar meta={helper.name} />
        <div className="flex min-h-0 flex-1 flex-col items-center overflow-y-auto">
          <div className="flex w-[860px] max-w-full flex-col gap-[24px] pt-[20px] pb-[32px]">
            {/* Top bar */}
            <div className="flex w-full items-center gap-[8px]">
              <Link to="/team" className="flex items-center gap-[6px] text-muted transition-colors hover:text-ink">
                <ArrowLeft size={14} aria-hidden />
                <span className="text-[13px]">Team</span>
              </Link>
              <span className="h-px flex-1" />
              <Btn icon={paused ? Play : Pause} h={30} onClick={togglePause}>
                {paused ? 'Resume' : 'Pause'}
              </Btn>
              <div className="relative">
                <IconBtn
                  icon={Ellipsis}
                  label="More actions"
                  onClick={() => setShowMoreMenu((v) => !v)}
                />
                {showMoreMenu && (
                  <MoreMenu
                    helperName={helper.name}
                    paused={paused}
                    onTogglePause={togglePause}
                    onLetGo={isChief ? undefined : () => { setShowMoreMenu(false); setState('letgo') }}
                    onClose={() => setShowMoreMenu(false)}
                  />
                )}
              </div>
            </div>

            {/* Hero */}
            <div className="flex w-full flex-col items-center gap-[10px] py-[4px]">
              <Mascot helper size={80} radius={18} area={helper.area} title={helper.name} />
              <h2 className="m-0 font-display text-[28px] font-semibold tracking-[-0.5px] text-ink">{helper.name}</h2>
              <div className="flex items-center gap-[10px]">
                <div className="relative">
                  <Pill
                    icon={helper.roleIcon}
                    label={`Role · ${role}`}
                    active={showRoleMenu}
                    onClick={() => setShowRoleMenu((v) => !v)}
                  />
                  {showRoleMenu && (
                    <RoleMenu
                      currentRole={role}
                      onPick={(r) => patch({ role: r }, `${helper.name} is now ${r}`)}
                      onClose={() => setShowRoleMenu(false)}
                    />
                  )}
                </div>
                <div className="relative">
                  <Pill
                    icon={Cpu}
                    label={model}
                    active={state === 'model'}
                    onClick={() => setState(state === 'model' ? undefined : 'model')}
                  />
                  {state === 'model' && (
                    <ModelMenu
                      helper={helper}
                      currentModel={model}
                      onPick={(m) => patch({ model: m }, m ? `${helper.name} now uses ${m}` : `${helper.name} uses the company default`)}
                      onClose={close}
                    />
                  )}
                </div>
                {paused ? <StatusChip status="Idle" label="Paused" /> : <StatusChip status={helper.status} />}
              </div>
              <p className="m-0 text-[12.5px] text-muted">{helper.statsLine}</p>
            </div>

            {/* Tabs */}
            <div
              role="tablist"
              className="flex w-full gap-[4px] rounded-pill bg-soft p-[4px] outline-1 -outline-offset-1 outline-line"
            >
              {TABS.map((t) => {
                const on = t.id === tab
                return (
                  <button
                    key={t.id}
                    type="button"
                    role="tab"
                    aria-selected={on}
                    onClick={() => go({ tab: t.id })}
                    className={`flex h-[36px] min-w-0 flex-1 items-center justify-center gap-[6px] rounded-pill transition-colors ${
                      on ? 'bg-surface shadow-[0_1px_3px_#0000001A]' : 'hover:bg-hover'
                    }`}
                  >
                    <span className={`text-[13.5px] ${on ? 'font-semibold text-ink' : 'font-medium text-muted'}`}>
                      {t.label}
                    </span>
                    {t.count && <span className="font-mono text-[12px] text-faint">{helper.counts[t.count]}</span>}
                  </button>
                )
              })}
            </div>

            {tab === 'job' && (
              <JobTab
                helper={helper}
                activeFile={state === 'playbook' ? openFile : undefined}
                onOpenFile={(f) => {
                  setOpenFile(f)
                  setState('playbook')
                }}
              />
            )}
            {tab === 'channels' && <ChannelsTab helper={helper} onConnect={(c) => setState(c)} />}
            {tab === 'behavior' && <BehaviorTab helper={helper} />}
            {tab === 'tools' && <ToolsTab helper={helper} />}
            {tab === 'skills' && <SkillsTab helper={helper} onBrowse={() => setState('browse')} />}
            {tab === 'profile' && (
              <ProfileTab helper={helper} onLetGo={isChief ? undefined : () => setState('letgo')} onTogglePause={togglePause} />
            )}
          </div>
        </div>
      </Inset>

      {state === 'playbook' && <PlaybookDrawer helper={helper} file={openFile} onClose={close} />}
      {state === 'telegram' && <ConnectTelegramDialog helper={helper} onClose={close} />}
      {state === 'whatsapp' && <ConnectWhatsAppDialog helper={helper} onClose={close} />}
      {state === 'email' && <ConnectEmailDialog helper={helper} onClose={close} />}
      {state === 'browse' && <BrowseSkillsDialog helper={helper} onClose={close} />}
      {state === 'letgo' && !isChief && <LetGoDialog helper={helper} onClose={close} onLetGo={letGo} />}
    </>
  )
}

/**
 * Route component for /team/$helperId — pen ZOLDU (Chief) · mM9lI (Builder) ·
 * TVKhl (Grower) · koZok (Sales) · w6dUO3 (Finance) · XB1kX (Support).
 * Tabs via `?tab=channels|behavior|tools|skills|profile`.
 *
 * Data source: useHelper(id) from the live repos layer (P8-T6).
 */
export function HelperDetail() {
  const params = useParams({ strict: false }) as { helperId?: string }
  const id = params.helperId ?? ''
  const { data: detail, isLoading, isError } = useHelperDetail(id)
  const { data: team = [] } = useHelpers()
  const { data: files = [] } = useHelperFiles(id)
  const { data: settings } = useCompanySettings()
  const ownerName = useSession((st) => st.user?.name) ?? 'you'

  if (isLoading) {
    return (
      <Inset label="Team">
        <TeamTopbar meta="Loading…" />
        <div className="flex flex-1 items-center justify-center text-[13px] text-muted">
          Loading helper…
        </div>
      </Inset>
    )
  }

  if (isError || !detail || detail.helper.status === 'retired') {
    return (
      <Inset label="Team">
        <TeamTopbar meta="Not found" />
        <div className="flex flex-1 items-center justify-center gap-[4px] text-[13px] text-muted">
          {detail?.helper.status === 'retired' ? `${detail.helper.name} was let go.` : 'Helper not found.'}
          <Link to="/team" className="text-link hover:underline">
            Back to Team
          </Link>
        </div>
      </Inset>
    )
  }

  const helper = buildHelperRecord(
    detail.helper,
    { helpers: team, ownerName, defaultModel: companyDefaultModel(settings) },
    detail,
    files,
  )
  return <HelperDetailPage key={helper.id} helper={helper} />
}

import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Bell, CheckCheck, Settings } from 'lucide-react'
import { Button, IconButton } from '../../ui/ds/Button'
import { Inset, Topbar } from '../../ui/ds/Frame'
import { Mascot } from '../../ui/ds/Mascot'
import { DECISIONS, NOTIF_GROUPS, filterNotifs } from './data'
import { NotificationsSidebar } from './NotificationsSidebar'
import type { Decision, Notif, NotifGroup, NotifFilter } from './data'
import { notify } from '../../ui/ds/Toaster'

// ── Pieces ────────────────────────────────────────────────────────────────────

/** "NEEDS YOU 3" section label in orange. */
function NeedsYouLabel({ count }: { count: number }) {
  return (
    <div className="flex items-center gap-[6px] px-[1px] pt-[2px]">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-[#C2410C]">NEEDS YOU</span>
      <span className="text-[11px] font-semibold text-[#C2410C]">{count}</span>
    </div>
  )
}

/** "TODAY" / "YESTERDAY" date-group label. */
function GroupLabel({ label }: { label: string }) {
  return (
    <div className="px-[1px] pb-[2px] pt-[6px]">
      <span className="text-[11px] font-semibold tracking-[0.06em] text-muted">{label}</span>
    </div>
  )
}

/** Full decision card with coloured left border, body, and action buttons. */
function DecisionCard({ decision, onResolve }: { decision: Decision; onResolve: (id: string, label: string) => void }) {
  return (
    <article
      aria-label={decision.title}
      className="flex w-full flex-col gap-[10px] rounded-lg outline-1 -outline-offset-1 outline-line-strong bg-surface p-[14px]"
      style={{ borderLeft: '3px solid #F97316', paddingLeft: 12 }}
    >
      {/* Header row */}
      <div className="flex w-full items-center gap-[7px]">
        <Mascot size={20} radius={6} area={decision.senderArea} />
        <span className="text-[12.5px] font-medium text-ink">{decision.senderName}</span>
        <span className="text-[12px] text-muted">{decision.ago}</span>
        <span
          className="inline-flex items-center rounded-pill px-[6px] py-[1px] text-[11px] font-medium text-muted"
          style={{ background: 'var(--color-hover)' }}
        >
          {decision.tag}
        </span>
        {/* unread dot */}
        <span className="ml-auto size-[7px] shrink-0 rounded-full bg-[#F97316]" aria-hidden />
      </div>

      {/* Body */}
      <div className="flex flex-col gap-[3px]">
        <p className="m-0 text-[13.5px] font-semibold text-ink">{decision.title}</p>
        <p className="m-0 text-[13px] leading-[1.5] text-ink-2">{decision.body}</p>
      </div>

      {/* Actions */}
      <div className="flex items-center gap-[6px]">
        {decision.actions.map((a) => (
          <Button
            key={a.label}
            height={28}
            variant={a.primary ? 'primary' : 'secondary'}
            onClick={() => onResolve(decision.id, a.label)}
          >
            {a.label}
          </Button>
        ))}
      </div>
    </article>
  )
}

/** A single notification row (compact, single-line with optional preview). */
function NotifRow({ notif, last, onClick }: { notif: Notif; last: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-start gap-[10px] py-[11px] text-left transition-colors hover:bg-hover ${
        last ? '' : 'border-b border-line'
      }`}
    >
      <Mascot size={20} radius={6} area={notif.senderArea} />
      <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
        <p className="m-0 text-[13px] font-medium leading-[1.4] text-ink">{notif.title}</p>
        {notif.preview && (
          <p className="m-0 line-clamp-1 text-[12.5px] leading-[1.4] text-ink-2">{notif.preview}</p>
        )}
        <div className="flex items-center gap-[5px] pt-[1px]">
          <span className="text-[11.5px] text-muted">{notif.ago}</span>
          <span
            className="inline-flex items-center rounded-pill px-[5px] py-[1px] text-[11px] font-medium text-muted"
            style={{ background: 'var(--color-hover)' }}
          >
            {notif.tag}
          </span>
        </div>
      </div>
      {notif.unread && (
        <span className="mt-[4px] size-[7px] shrink-0 rounded-full bg-info" aria-label="unread" />
      )}
    </button>
  )
}

/** One date group with its notification rows. */
function NotifGroupSection({ group, onRowClick }: { group: NotifGroup; onRowClick: (notif: Notif) => void }) {
  return (
    <section aria-label={group.label}>
      <GroupLabel label={group.label} />
      <div className="flex flex-col">
        {group.items.map((notif, i) => (
          <NotifRow
            key={notif.id}
            notif={notif}
            last={i === group.items.length - 1}
            onClick={() => onRowClick(notif)}
          />
        ))}
      </div>
    </section>
  )
}

// ── NotificationsRoute ────────────────────────────────────────────────────────

/**
 * /notifications — Everything helpers sent you.
 * A filter sidebar scopes the decisions + notification list.
 * Decisions waiting on you are pinned at the top; grouped notifications follow.
 *
 * Local state owns decisions + groups (copy of static data) so actions can
 * mutate (remove resolved decisions, mark all read) without touching data.ts.
 */
export function NotificationsRoute() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState<NotifFilter>('all')

  // Lift static data into local state so we can mutate it
  const [allDecisions, setAllDecisions] = useState(DECISIONS)
  const [allGroups, setAllGroups] = useState(NOTIF_GROUPS)

  // Re-filter from local state
  const { decisions, groups } = filterNotifs(filter, allDecisions, allGroups)

  const totalDecisions = decisions.length
  const totalUnread = groups.flatMap((g) => g.items).filter((n) => n.unread).length

  function resolveDecision(id: string, label: string) {
    setAllDecisions((prev) => prev.filter((d) => d.id !== id))
    notify(`${label} — decision resolved`)
  }

  function markAllRead() {
    setAllGroups((prev) =>
      prev.map((g) => ({
        ...g,
        items: g.items.map((n) => ({ ...n, unread: false })),
      })),
    )
  }

  function handleRowClick(_notif: Notif) {
    void navigate({ to: '/chat' })
  }

  return (
    <>
      <NotificationsSidebar filter={filter} onFilter={setFilter} />

      <Inset label="Notifications">
        {/* Topbar */}
        <Topbar
          icon={Bell}
          title="Notifications"
          meta={
            totalDecisions > 0
              ? `${totalDecisions} decisions waiting on you · ${totalUnread} unread`
              : `${totalUnread} unread`
          }
          actions={
            <>
              <Button variant="secondary" height={28} icon={CheckCheck} onClick={markAllRead}>
                Mark all read
              </Button>
              <IconButton
                icon={Settings}
                aria-label="Notification settings"
                onClick={() => void navigate({ to: '/control-panel/$section', params: { section: 'notifications' } })}
              />
            </>
          }
        />

        {/* Scrollable content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-[24px] py-[20px]">
          {/* Page heading */}
          <header className="flex flex-col gap-[2px] pb-[20px]">
            <h1 className="m-0 font-display text-[22px] font-semibold tracking-[-0.4px] text-ink">
              Notifications
            </h1>
            <p className="m-0 text-[13px] text-muted">
              {totalDecisions} decisions waiting on you · {totalUnread} unread
            </p>
          </header>

          {/* Pinned decisions */}
          {decisions.length > 0 && (
            <section aria-label="Needs you" className="flex flex-col gap-[8px] pb-[24px]">
              <NeedsYouLabel count={decisions.length} />
              {decisions.map((d) => (
                <DecisionCard key={d.id} decision={d} onResolve={resolveDecision} />
              ))}
            </section>
          )}

          {/* Grouped notification list */}
          <div className="flex flex-col gap-[4px]">
            {groups.map((group) => (
              <NotifGroupSection key={group.label} group={group} onRowClick={handleRowClick} />
            ))}
          </div>
        </div>
      </Inset>
    </>
  )
}

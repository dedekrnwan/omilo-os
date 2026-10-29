import { useState, useMemo } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Crown, Ellipsis, Mail, Pencil, Plus, RotateCw, Server, Trash2, UserPlus } from 'lucide-react'
import { Chip, DialogCard, Field, Group, Initials, PageHeader, PageShell, PenButton, lineBottom } from '../ControlPanelShared'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { ConfirmDialog } from '../../../ui/ds/ConfirmDialog'
import type { SectionProps } from '../ControlPanel'
import { notify } from '../../../ui/ds/Toaster'
import {
  useChangeMemberRole,
  useInvites,
  useMembers,
  useRemoveMember,
  useResendInvite,
  useRevokeInvite,
  useSeats,
  useUpdateMember,
} from '../../../app/queries'
import type { CompanyMember } from '../../../core/domain/types'
import type { Invite } from '../../../core/domain/controlPanel'
import { useSession } from '../../../app/session'
import { ChannelPicker } from '../ChannelPicker'
import { colorFor as memberColor, errorMessage, formatIdrShort, initialsOf as initials, lastSeenLabel } from '../format'

const ROLES = [
  { r: 'Owner', d: 'Everything, including billing and deleting the company.' },
  { r: 'Admin', d: 'Settings, connectors and approving spend. No billing.' },
  { r: 'Member', d: 'Chat, goals and flows in their channels. Approves their own flows.' },
  { r: "Viewer", d: "Reads goals, docs and runs. Cannot approve or change anything. Free." },
]

const ROLE_OPTIONS = ['Admin', 'Member', 'Viewer'] as const
type RoleOption = (typeof ROLE_OPTIONS)[number]

const COL = 'text-[10.5px] font-medium tracking-[0.8px] text-faint'

function Legend({ color, label }: { color: string; label: string }) {
  return (
    <span className="flex items-center gap-[6px]">
      <span className="size-[8px] rounded-[2px]" style={{ background: color }} />
      <span className="text-[12px] text-muted">{label}</span>
    </span>
  )
}

/** Role dropdown for non-Owner members. */
function RoleDropdown({ role, onChange }: { role: string; onChange: (r: RoleOption) => void }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" className="w-[150px]">
          <Field width={150} value={role} select />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="start" sideOffset={4} className={`z-50 w-[180px] ${menuSurface}`}>
          {ROLE_OPTIONS.map((r) => (
            <DropdownMenu.Item key={r} className={menuItemClass} onSelect={() => onChange(r)}>
              <span className="text-[13px] text-ink">{r}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

/** ⋯ options menu for a member row. */
function MemberMoreMenu({ name, onEdit, onRemove }: { name: string; onEdit: () => void; onRemove: () => void }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`${name} options`} className="flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted hover:bg-hover">
          <Ellipsis size={16} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
          <DropdownMenu.Item className={menuItemClass} onSelect={onEdit}>
            <MenuItemBody icon={Pencil} label="Edit" />
          </DropdownMenu.Item>
          <MenuSeparatorLine />
          <DropdownMenu.Item className={menuItemClass} onSelect={onRemove}>
            <MenuItemBody icon={Trash2} label="Remove" danger />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type PersonRow = {
  id: string
  userId: string
  email: string
  name: string
  initials: string
  color: string
  channels: string
  channelIds: string[]
  role: string
  seen: string
}

/** Map a CompanyMember to a PersonRow for display. */
function toPersonRow(m: CompanyMember, meId?: string): PersonRow {
  return {
    id: m.id,
    userId: m.userId,
    email: m.email,
    name: m.name,
    initials: initials(m.name),
    color: memberColor(m.id),
    channels: m.channelNames?.length ? m.channelNames.join(', ') : 'All channels',
    channelIds: m.channels ?? [],
    role: m.role.charAt(0).toUpperCase() + m.role.slice(1),
    seen: m.userId === meId ? 'active you' : lastSeenLabel(m.lastSeenAt),
  }
}

/** Edit a member: role (non-owners) + the channels they work in. */
function EditMemberDialog({ person, onClose }: { person: PersonRow; onClose: () => void }) {
  const updateMember = useUpdateMember()
  const [role, setRole] = useState(person.role)
  const [channelIds, setChannelIds] = useState<string[]>(person.channelIds)
  const isOwner = person.role === 'Owner'

  async function save() {
    try {
      await updateMember.mutateAsync({
        id: person.id,
        input: {
          ...(isOwner || role === person.role ? {} : { role: role.toLowerCase() }),
          ...(channelIds.length ? { channels: channelIds } : { allChannels: true }),
        },
      })
      notify(`${person.name} updated`)
      onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not update member'))
    }
  }

  return (
    <DialogCard
      width={440}
      icon={Pencil}
      title={`Edit ${person.name}`}
      sub={person.email}
      onClose={onClose}
      footer={
        <>
          <PenButton fs={13} onClick={onClose}>Cancel</PenButton>
          <div className="h-px flex-1" />
          <PenButton variant="primary" fs={13} disabled={updateMember.isPending} onClick={() => void save()}>
            {updateMember.isPending ? 'Saving…' : 'Save'}
          </PenButton>
        </>
      }
    >
      {isOwner ? (
        <Field label="Role" value="Owner" />
      ) : (
        <Field label="Role" value={role} onChange={setRole} options={[...ROLE_OPTIONS]} select />
      )}
      <ChannelPicker value={channelIds} onChange={setChannelIds} className="w-full" />
      <span className="text-[12px] text-muted">Members only see chats, goals and flows in their channels.</span>
    </DialogCard>
  )
}

/** pen ZDdLD · Members & roles — and X16ZX · Self-hosted (variant). */
export function SectionMembers({ onDialog, variant }: SectionProps) {
  const companyName = useSession((s) => s.company?.name) ?? 'your company'
  const meId = useSession((s) => s.user?.id)
  const { data: fetchedMembers, isLoading, isError } = useMembers()
  const { data: seats } = useSeats()
  const { data: invites = [] } = useInvites()
  const revokeInvite = useRevokeInvite()
  const resendInvite = useResendInvite()
  const selfHosted = variant === 'self-hosted' || (variant !== 'cloud' && !!seats?.selfHosted)
  const [editing, setEditing] = useState<PersonRow | null>(null)

  // Convert API members to PersonRow; fall back to empty while loading
  const apiRows = useMemo<PersonRow[]>(
    () => (fetchedMembers ?? []).map((m) => toPersonRow(m, meId)),
    [fetchedMembers, meId],
  )

  const changeRoleMutation = useChangeMemberRole()
  const removeMemberMutation = useRemoveMember()

  // Local state: role per person (keyed by email) — initialised from API data
  const [roles, setRoles] = useState<Record<string, string>>({})
  const [removedEmails, setRemovedEmails] = useState<Set<string>>(new Set())
  const [removeTarget, setRemoveTarget] = useState<PersonRow | null>(null)

  // Merge API rows with local overrides and removals
  const members = useMemo<PersonRow[]>(() => {
    return apiRows
      .filter((p) => !removedEmails.has(p.email))
      .map((p) => ({ ...p, role: roles[p.email] ?? p.role }))
  }, [apiRows, roles, removedEmails])

  async function changeRole(row: PersonRow, r: RoleOption) {
    const prevRole = row.role
    // optimistic
    setRoles((prev) => ({ ...prev, [row.email]: r }))
    try {
      await changeRoleMutation.mutateAsync({ id: row.id, role: r.toLowerCase() })
      notify(`${row.name} is now ${r}`)
    } catch (e) {
      // Roll back + surface the backend guard (e.g. last-owner demote → 400).
      setRoles((prev) => ({ ...prev, [row.email]: prevRole }))
      notify(e instanceof Error && e.message ? e.message : 'Could not change role')
    }
  }

  async function handleRevokeInvite(inv: Invite) {
    try {
      await revokeInvite.mutateAsync(inv.id)
      notify(`Invite for ${inv.email} revoked`)
    } catch (e) {
      notify(errorMessage(e, 'Could not revoke invite'))
    }
  }

  async function handleResendInvite(inv: Invite) {
    try {
      await resendInvite.mutateAsync(inv.id)
      notify(`Invite re-sent to ${inv.email}`)
    } catch (e) {
      notify(errorMessage(e, 'Could not resend invite'))
    }
  }

  /** Seats-full → Seats full / Plan max dialog; otherwise the plain invite. */
  function openInvite() {
    if (selfHosted || !seats || seats.unlimited || (seats.available ?? 1) > 0) return onDialog('invite')
    const atMax = seats.max != null && (seats.total ?? 0) >= seats.max
    onDialog(atMax || !seats.canAdd ? 'plan-max' : 'seats-full')
  }

  // Seat bar: people · pending invites · free seats.
  const used = seats?.used ?? members.filter((m) => m.role !== 'Viewer').length
  const pendingSeats = seats?.pending ?? 0
  const totalSeats = seats?.total ?? 0
  const freeSeats = Math.max(0, totalSeats - used - pendingSeats)
  const seatsFull = !selfHosted && !!seats && !seats.unlimited && freeSeats === 0
  const viewerCount = seats?.viewers ?? members.filter((m) => m.role === 'Viewer').length

  async function confirmRemove() {
    if (!removeTarget) return
    const target = removeTarget
    try {
      await removeMemberMutation.mutateAsync(target.id)
      setRemovedEmails((prev) => new Set([...prev, target.email]))
      notify(`${target.name} removed`)
    } catch (e) {
      // Surface last-owner / role-guard errors rather than swallow them.
      notify(e instanceof Error && e.message ? e.message : 'Could not remove member')
    }
  }

  if (isLoading) {
    return (
      <PageShell crumb="Members & roles">
        <p className="text-[13px] text-muted">Loading members…</p>
      </PageShell>
    )
  }

  if (isError) {
    return (
      <PageShell crumb="Members & roles">
        <p className="text-[13px] text-danger">Failed to load members.</p>
      </PageShell>
    )
  }

  return (
    <PageShell crumb="Members & roles">
      <PageHeader
        title="Members & roles"
        sub={`People in ${companyName} and what they can approve.`}
        actions={
          <PenButton variant="primary" icon={UserPlus} onClick={openInvite}>
            Invite people
          </PenButton>
        }
      />

      <div className="flex w-full items-center gap-[20px] rounded-lg bg-soft px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong">
        {selfHosted ? (
          <div className="flex min-w-0 flex-1 items-center gap-[8px]">
            <span className="text-[13px] font-semibold text-ink">
              {members.length} {members.length === 1 ? 'person' : 'people'}, {invites.length} invite{invites.length === 1 ? '' : 's'} · unlimited seats
            </span>
            <Chip tone="ok" icon={Server}>Self-hosted · free</Chip>
            <div className="h-px flex-1" />
            <span className="text-[12px] text-muted">Free — invite as many people as you like</span>
          </div>
        ) : seats?.unlimited ? (
          <div className="flex min-w-0 flex-1 items-center gap-[8px]">
            <span className="text-[13px] font-semibold text-ink">
              {used} {used === 1 ? 'person' : 'people'}
              {pendingSeats > 0 ? `, ${pendingSeats} pending invite${pendingSeats === 1 ? '' : 's'}` : ''}
              {viewerCount > 0 ? ` · ${viewerCount} viewer${viewerCount === 1 ? '' : 's'}` : ''}
            </span>
            <div className="h-px flex-1" />
            <span className="text-[12px] text-muted">{seats.planName ?? 'Your'} plan · unlimited people, no per-seat fees</span>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
              <div className="flex w-full items-center gap-[8px]">
                <span className="text-[13px] font-semibold text-ink">{used + pendingSeats} of {totalSeats} seats</span>
                {seatsFull && <Chip tone="warn">Full</Chip>}
                <div className="h-px flex-1" />
                <span className="text-[12px] text-muted">
                  {seats?.planName ?? 'No'} plan · {seats?.included ?? 0} included{seats?.max != null ? `, up to ${seats.max}` : seats?.canAdd ? ', add more any time' : ''}
                </span>
              </div>
              <div className="flex h-[6px] w-full gap-[3px]">
                {Array.from({ length: Math.min(used, 40) }, (_, i) => (
                  <span key={`u${i}`} className="h-[6px] flex-1 rounded-[3px] bg-ink" />
                ))}
                {Array.from({ length: Math.min(pendingSeats, 40) }, (_, i) => (
                  <span key={`p${i}`} className="h-[6px] flex-1 rounded-[3px] bg-spark" />
                ))}
                {Array.from({ length: Math.min(freeSeats, 40) }, (_, i) => (
                  <span key={`f${i}`} className="h-[6px] flex-1 rounded-[3px] bg-wire-strong" />
                ))}
              </div>
              <div className="flex items-center gap-[14px]">
                <Legend color="var(--color-ink)" label={`${used} ${used === 1 ? 'person' : 'people'}`} />
                {pendingSeats > 0 && (
                  <Legend color="var(--color-spark)" label={`${pendingSeats} pending invite${pendingSeats === 1 ? '' : 's'} (holds a seat)`} />
                )}
                <Legend color="var(--color-wire-strong)" label={`Viewers are free · ${viewerCount}`} />
              </div>
            </div>
            {seats?.canAdd && (
              <>
                <span className="h-[44px] w-px shrink-0 bg-line-strong" />
                <div className="flex flex-col items-end gap-[6px]">
                  <PenButton h={30} fs={13} icon={Plus} onClick={() => onDialog('add-seats')}>Add seats</PenButton>
                  <span className="text-[11.5px] text-muted">{formatIdrShort(seats.seatPriceIdr)} / seat / month</span>
                </div>
              </>
            )}
          </>
        )}
      </div>

      <div className="flex w-full flex-col overflow-hidden rounded-lg outline-1 -outline-offset-1 outline-line-strong">
        <div className={`flex w-full gap-[14px] bg-soft px-[14px] py-[8px] ${lineBottom}`}>
          <span className={`flex-1 ${COL}`}>PERSON</span>
          <span className={`w-[190px] ${COL}`}>CHANNELS</span>
          <span className={`w-[150px] ${COL}`}>ROLE</span>
          <span className="w-[28px]" />
        </div>
        {members.map((p) => (
          <div key={p.email} className={`flex w-full items-center gap-[14px] px-[14px] py-[10px] ${lineBottom}`}>
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
              <Initials text={p.initials} color={p.color} />
              <div className="flex flex-col gap-px">
                <span className="text-[13px] font-medium text-ink">{p.name}</span>
                <span className="text-[11.5px] text-muted">{p.email}{p.seen ? ` · ${p.seen}` : ''}</span>
              </div>
            </div>
            <span className="w-[190px] text-[12px] text-ink-2">{p.channels}</span>
            <div className="w-[150px]">
              {p.role === 'Owner' ? (
                <Chip icon={Crown}>Owner</Chip>
              ) : (
                <RoleDropdown role={p.role} onChange={(r) => void changeRole(p, r)} />
              )}
            </div>
            <MemberMoreMenu
              name={p.name}
              onEdit={() => setEditing(p)}
              onRemove={() => setRemoveTarget(p)}
            />
          </div>
        ))}
        {invites.map((inv) => (
          <div key={inv.id} className={`flex w-full items-center gap-[14px] px-[14px] py-[10px] ${lineBottom}`}>
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
              <span className="flex size-[28px] shrink-0 items-center justify-center rounded-full bg-soft outline-1 -outline-offset-1 outline-line-strong">
                <Mail size={13} aria-hidden className="text-muted" />
              </span>
              <div className="flex min-w-0 flex-col gap-px">
                <span className="truncate text-[13px] font-medium text-ink">{inv.email}</span>
                <span className="text-[11.5px] text-muted">Invite pending{inv.invitedBy ? ` · from ${inv.invitedBy}` : ''}</span>
              </div>
            </div>
            <span className="w-[190px] text-[12px] text-ink-2">{inv.channelNames?.length ? inv.channelNames.join(', ') : 'All channels'}</span>
            <div className="flex w-[150px] items-center gap-[6px]">
              <Chip tone="warn">{inv.role.charAt(0).toUpperCase() + inv.role.slice(1)}</Chip>
            </div>
            <DropdownMenu.Root modal={false}>
              <DropdownMenu.Trigger asChild>
                <button type="button" aria-label={`${inv.email} invite options`} className="flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted hover:bg-hover">
                  <Ellipsis size={16} aria-hidden />
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => void handleResendInvite(inv)}>
                    <MenuItemBody icon={RotateCw} label="Resend invite" />
                  </DropdownMenu.Item>
                  <MenuSeparatorLine />
                  <DropdownMenu.Item className={menuItemClass} onSelect={() => void handleRevokeInvite(inv)}>
                    <MenuItemBody icon={Trash2} label="Revoke" danger />
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          </div>
        ))}
      </div>
      {editing && <EditMemberDialog person={editing} onClose={() => setEditing(null)} />}

      <Group title="What each role can do">
        <div className="flex w-full gap-[10px]">
          {ROLES.map((r) => (
            <div key={r.r} className="flex min-w-0 flex-1 flex-col gap-[4px] rounded-md bg-soft p-[12px]">
              <span className="text-[12.5px] font-semibold text-ink">{r.r}</span>
              <span className="text-[11.5px] leading-[1.45] text-muted">{r.d}</span>
            </div>
          ))}
        </div>
      </Group>

      <ConfirmDialog
        open={removeTarget !== null}
        onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}
        title={`Remove ${removeTarget?.name ?? ''}?`}
        message="They lose access to this workspace immediately. You can invite them again later."
        confirmLabel="Remove"
        tone="danger"
        onConfirm={() => void confirmRemove()}
      />
    </PageShell>
  )
}

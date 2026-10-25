import { useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Crown, Ellipsis, Mail, Pencil, Plus, Server, Trash2, UserPlus } from 'lucide-react'
import { Chip, Field, Group, Initials, PageHeader, PageShell, PenButton, lineBottom } from '../ControlPanelShared'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../../../ui/ds/Menu'
import { PEOPLE } from '../data'
import type { SectionProps } from '../ControlPanel'

const ROLES = [
  { r: 'Owner', d: 'Everything, including billing and deleting the company.' },
  { r: 'Admin', d: 'Settings, connectors and approving spend. No billing.' },
  { r: 'Member', d: 'Chat, goals and flows in their channels. Approves their own flows.' },
  { r: "Viewer", d: "Reads goals, docs and runs. Cannot approve or change anything. Free. Does not use a seat." },
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
function MemberMoreMenu({ name }: { name: string }) {
  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger asChild>
        <button type="button" aria-label={`${name} options`} className="flex size-[28px] shrink-0 items-center justify-center rounded-sm text-muted hover:bg-hover">
          <Ellipsis size={16} aria-hidden />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={4} className={`z-50 w-[200px] ${menuSurface}`}>
          <DropdownMenu.Item className={menuItemClass} onSelect={() => {}}>
            <MenuItemBody icon={Pencil} label="Edit" />
          </DropdownMenu.Item>
          <MenuSeparatorLine />
          <DropdownMenu.Item className={menuItemClass} onSelect={() => {}}>
            <MenuItemBody icon={Trash2} label="Remove" danger />
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

type PersonRow = { email: string; name: string; initials: string; color: string; channels: string; role: string; seen: string }

/** pen ZDdLD · Members & roles — and X16ZX · Self-hosted (variant). */
export function SectionMembers({ onDialog, variant }: SectionProps) {
  const selfHosted = variant === 'self-hosted'

  // Local state: role per person (keyed by email)
  const [roles, setRoles] = useState<Record<string, string>>(() =>
    Object.fromEntries(PEOPLE.map((p) => [p.email, p.role])),
  )

  function changeRole(email: string, r: RoleOption) {
    setRoles((prev) => ({ ...prev, [email]: r }))
  }

  return (
    <PageShell crumb="Members & roles">
      <PageHeader
        title="Members & roles"
        sub="People in Sahabat Warga and what they can approve."
        actions={
          <PenButton variant="primary" icon={UserPlus} onClick={() => onDialog(selfHosted ? 'invite' : 'seats-full')}>
            Invite people
          </PenButton>
        }
      />

      <div className="flex w-full items-center gap-[20px] rounded-lg bg-soft px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong">
        {selfHosted ? (
          <div className="flex min-w-0 flex-1 items-center gap-[8px]">
            <span className="text-[13px] font-semibold text-ink">4 people, 1 invite · unlimited seats</span>
            <Chip tone="ok" icon={Server}>Self-hosted · free</Chip>
            <div className="h-px flex-1" />
            <span className="text-[12px] text-muted">Free — invite as many people as you like</span>
          </div>
        ) : (
          <>
            <div className="flex min-w-0 flex-1 flex-col gap-[8px]">
              <div className="flex w-full items-center gap-[8px]">
                <span className="text-[13px] font-semibold text-ink">5 of 5 seats</span>
                <Chip tone="warn">Full</Chip>
                <div className="h-px flex-1" />
                <span className="text-[12px] text-muted">Team plan · 5 included, up to 15</span>
              </div>
              <div className="flex h-[6px] w-full gap-[3px]">
                {[0, 1, 2, 3].map((i) => (
                  <span key={i} className="h-[6px] flex-1 rounded-[3px] bg-ink" />
                ))}
                <span className="h-[6px] flex-1 rounded-[3px] bg-spark" />
              </div>
              <div className="flex items-center gap-[14px]">
                <Legend color="var(--color-ink)" label="4 people" />
                <Legend color="var(--color-spark)" label="1 pending invite (holds a seat)" />
                <Legend color="var(--color-wire-strong)" label="Viewers are free · 0 of 20" />
              </div>
            </div>
            <span className="h-[44px] w-px shrink-0 bg-line-strong" />
            <div className="flex flex-col items-end gap-[6px]">
              <PenButton h={30} fs={13} icon={Plus} onClick={() => onDialog('add-seats')}>Add seats</PenButton>
              <span className="text-[11.5px] text-muted">Rp 150 rb / seat / month</span>
            </div>
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
        {([...PEOPLE] as PersonRow[]).map((p) => (
          <div key={p.email} className={`flex w-full items-center gap-[14px] px-[14px] py-[10px] ${lineBottom}`}>
            <div className="flex min-w-0 flex-1 items-center gap-[10px]">
              <Initials text={p.initials} color={p.color} />
              <div className="flex flex-col gap-px">
                <span className="text-[13px] font-medium text-ink">{p.name}</span>
                <span className="text-[11.5px] text-muted">{p.email} · {p.seen}</span>
              </div>
            </div>
            <span className="w-[190px] text-[12px] text-ink-2">{p.channels}</span>
            <div className="w-[150px]">
              {roles[p.email] === 'Owner' ? (
                <Chip icon={Crown}>Owner</Chip>
              ) : (
                <RoleDropdown role={roles[p.email] ?? p.role} onChange={(r) => changeRole(p.email, r)} />
              )}
            </div>
            <MemberMoreMenu name={p.name} />
          </div>
        ))}
        <div className="flex w-full items-center gap-[14px] px-[14px] py-[10px]">
          <div className="flex min-w-0 flex-1 items-center gap-[10px]">
            <span className="flex size-[28px] shrink-0 items-center justify-center rounded-full outline-[1.5px] -outline-offset-[1.5px] outline-wire-strong">
              <Mail size={13} aria-hidden className="text-muted" />
            </span>
            <div className="flex flex-col gap-px">
              <span className="text-[13px] font-medium text-ink">andi@saga.co.id</span>
              <span className="text-[11.5px] text-muted">Invite sent · expires in 6 days</span>
            </div>
          </div>
          <span className="w-[190px] text-[12px] text-ink-2">Business</span>
          <div className="w-[150px]">
            <RoleDropdown role="Member" onChange={() => {}} />
          </div>
          <MemberMoreMenu name="andi@saga.co.id" />
        </div>
      </div>

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
    </PageShell>
  )
}

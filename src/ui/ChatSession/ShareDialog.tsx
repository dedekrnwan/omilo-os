import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { ChevronDown, Link, Lock, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { useState } from 'react'
import type { CompanyMember, ShareMember, Shares } from '../../core/domain/types'
import {
  useFolderShares,
  useMembers,
  useSessionShares,
  useSetFolderShares,
  useSetSessionShares,
} from '../../app/queries'
import { useSession as useAuthSession } from '../../app/session'
import { Drawer } from '../ds/Drawer'
import { notify } from '../ds/Toaster'
import { copyText } from '../ds/ItemMenu'
import { menuSurface, menuItemClass } from '../ds/Menu'

// ── Share dialog (pen `Chat · Session · Share` P334a, dialog frhtA) ───────────
// People and permissions persist through PUT /v1/sessions|folders/{id}/shares.

export interface ShareTarget {
  kind: 'session' | 'folder'
  id: string
}

interface ShareDialogProps {
  title: string
  open: boolean
  onOpenChange: (open: boolean) => void
  /** What is being shared (a chat or a folder). */
  target: ShareTarget
}

type Perm = 'can_talk' | 'can_view'
const PERM_LABEL: Record<Perm, string> = { can_talk: 'Can talk', can_view: 'Can view' }

/** pen `Select` (gVDns) field only: 130 × 36 · radius 8 · line-strong · value 13 ink · chevron 16 muted. */
function PermissionSelect<T extends string>({
  value,
  label,
  options,
  onSelect,
}: {
  value: string
  label: string
  options: { value: T; label: string }[]
  onSelect: (v: T) => void
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          aria-label={label}
          className="flex h-[36px] w-[130px] shrink-0 items-center gap-[8px] rounded-base bg-surface px-[10px] text-left outline-1 -outline-offset-1 outline-line-strong transition-colors hover:bg-soft data-[state=open]:outline-[1.5px] data-[state=open]:-outline-offset-[1.5px] data-[state=open]:outline-ink"
        >
          <span className="flex-1 text-[13px] text-ink">{value}</span>
          <ChevronDown size={16} aria-hidden className="text-muted" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="end" sideOffset={4} className={`z-[60] w-[140px] ${menuSurface}`}>
          {options.map((opt) => (
            <DropdownMenu.Item key={opt.value} onSelect={() => onSelect(opt.value)} className={menuItemClass}>
              <span className="flex-1 text-[13px] text-ink">{opt.label}</span>
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase())
    .join('')
}

const AVATAR_BG = ['#D6D3D1', '#FDE68A', '#BFDBFE', '#BBF7D0', '#FBCFE8', '#DDD6FE']
function avatarBg(id: string) {
  let h = 0
  for (const c of id) h = (h * 31 + c.charCodeAt(0)) >>> 0
  return AVATAR_BG[h % AVATAR_BG.length]
}

function Person({ avatar, bg, name, sub, right }: { avatar: ReactNode; bg: string; name: string; sub: string; right: ReactNode }) {
  return (
    <div className="flex w-full items-center gap-[10px]">
      <span
        className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-full text-[11px] font-semibold text-ink-2"
        style={{ background: bg }}
      >
        {avatar}
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
        <span className="truncate text-[13px] font-medium text-ink">{name}</span>
        <span className="truncate text-[12px] text-muted">{sub}</span>
      </div>
      {right}
    </div>
  )
}

export function ShareDialog({ title, open, onOpenChange, target }: ShareDialogProps) {
  if (!open) return null
  return <ShareDrawer title={title} onClose={() => onOpenChange(false)} target={target} />
}

function ShareDrawer({ title, onClose, target }: { title: string; onClose: () => void; target: ShareTarget }) {
  const isChat = target.kind === 'session'
  const sessionShares = useSessionShares(target.id, isChat)
  const folderShares = useFolderShares(target.id, !isChat)
  const setSessionShares = useSetSessionShares()
  const setFolderShares = useSetFolderShares()
  const { data: members = [] } = useMembers()
  const me = useAuthSession((s) => s.user)
  const companyName = useAuthSession((s) => s.company?.name) ?? 'your company'
  const [query, setQuery] = useState('')

  const shares: Shares | undefined = isChat ? sessionShares.data : folderShares.data
  const loading = isChat ? sessionShares.isLoading : folderShares.isLoading
  const people = shares?.members ?? []
  const added = new Set(people.map((p) => p.userId))
  const q = query.trim().toLowerCase()
  const candidates: CompanyMember[] = q
    ? members.filter((m) => !added.has(m.userId) && `${m.name} ${m.email}`.toLowerCase().includes(q)).slice(0, 5)
    : []

  function save(next: ShareMember[], generalAccess = shares?.generalAccess) {
    const input = {
      members: next
        .filter((m) => m.permission !== 'owner')
        .map((m) => ({ userId: m.userId, permission: m.permission as Perm })),
      ...(isChat && generalAccess ? { generalAccess } : {}),
    }
    const opts = { onError: () => notify('Couldn’t update sharing — try again') }
    if (isChat) setSessionShares.mutate({ id: target.id, input }, opts)
    else setFolderShares.mutate({ id: target.id, input }, opts)
  }

  function add(m: CompanyMember) {
    setQuery('')
    save([...people, { userId: m.userId, name: m.name, email: m.email, permission: 'can_talk' }])
    notify(`Shared with ${m.name}`)
  }

  return (
    <Drawer
      title={`Share "${title}"`}
      subtitle={
        isChat
          ? 'People you add see the whole chat and can talk to the helpers in it.'
          : 'People you add see every chat in this folder.'
      }
      onClose={onClose}
      width={500}
      bodyClass="gap-[16px] p-[20px]"
      footer={
        <>
          <button
            type="button"
            onClick={() => { copyText(window.location.href); notify('Link copied') }}
            className="inline-flex h-[32px] items-center gap-[6px] rounded-btn px-[14px] text-[13px] text-muted transition-colors hover:bg-hover"
          >
            <Link size={16} aria-hidden />
            Copy link
          </button>
          <span className="h-px flex-1" />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-[32px] items-center justify-center rounded-btn bg-primary px-[14px] text-[13px] font-medium text-primary-ink outline-1 -outline-offset-1 outline-primary transition-colors hover:bg-primary-hover"
          >
            Done
          </button>
        </>
      }
    >
      <div className="relative w-full">
        <label className="flex h-[36px] w-full items-center gap-[8px] rounded-base bg-surface px-[10px] outline-1 -outline-offset-1 outline-line-strong">
          <Search size={16} aria-hidden className="text-muted" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && candidates[0]) {
                e.preventDefault()
                add(candidates[0])
              }
            }}
            placeholder="Add people by name or email…"
            aria-label="Add people, emails or a channel"
            className="min-w-0 flex-1 bg-transparent text-[14px] text-ink outline-none placeholder:text-faint"
          />
        </label>
        {q && (
          <div role="listbox" aria-label="People to add" className={`absolute top-[40px] right-0 left-0 z-[60] ${menuSurface}`}>
            {candidates.length === 0 ? (
              <span className="px-[8px] py-[6px] text-[12.5px] text-muted">No one in {companyName} matches.</span>
            ) : (
              candidates.map((m) => (
                <button
                  key={m.userId}
                  type="button"
                  role="option"
                  aria-selected={false}
                  onClick={() => add(m)}
                  className={`${menuItemClass} w-full text-left`}
                >
                  <span className="flex-1 truncate text-[13px] text-ink">{m.name}</span>
                  <span className="truncate text-[12px] text-muted">{m.email}</span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <span className="text-[10.5px] font-semibold tracking-[1px] text-faint">WHO HAS ACCESS</span>

      <div className="flex w-full flex-col gap-[10px]">
        {loading && <span className="text-[13px] text-muted">Loading…</span>}
        {!loading && people.length === 0 && (
          <span className="text-[13px] text-muted">Not shared with anyone yet.</span>
        )}
        {people.map((p) => (
          <Person
            key={p.userId}
            avatar={initials(p.name)}
            bg={avatarBg(p.userId)}
            name={p.userId === me?.id ? `${p.name} (you)` : p.name}
            sub={p.email}
            right={
              p.permission === 'owner' ? (
                <span className="text-[12.5px] text-muted">Owner</span>
              ) : (
                <PermissionSelect<Perm | 'remove'>
                  value={PERM_LABEL[p.permission as Perm] ?? 'Can talk'}
                  label={`${p.name} access`}
                  options={[
                    { value: 'can_talk', label: 'Can talk' },
                    { value: 'can_view', label: 'Can view' },
                    { value: 'remove', label: 'Remove' },
                  ]}
                  onSelect={(v) =>
                    save(
                      v === 'remove'
                        ? people.filter((x) => x.userId !== p.userId)
                        : people.map((x) => (x.userId === p.userId ? { ...x, permission: v } : x)),
                    )
                  }
                />
              )
            }
          />
        ))}
      </div>

      <div className="flex w-full items-center gap-[10px] rounded-md bg-soft px-[12px] py-[10px]">
        <Lock size={15} aria-hidden className="shrink-0 text-muted" />
        <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
          <span className="text-[13px] font-medium text-ink">People added get it in their sidebar</span>
          <span className="truncate text-[12px] text-muted">
            {isChat ? 'Chats in an area are visible to everyone in' : 'Folders in an area are visible to everyone in'} {companyName}
          </span>
        </div>
      </div>
    </Drawer>
  )
}

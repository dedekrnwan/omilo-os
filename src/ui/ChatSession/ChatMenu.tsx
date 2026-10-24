import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import type { LucideIcon } from 'lucide-react'
import { Archive, FileDown, FolderInput, Link, Pencil, Pin, Target, Trash2 } from 'lucide-react'
import { MenuItemBody, MenuSeparatorLine, menuItemClass, menuSurface } from '../ds/Menu'

// ── Chat menu (pen `Chat · Session · Chat menu` ERnYB) — the topbar "…" dropdown ──

interface ChatMenuProps {
  onRename?: () => void
  onMoveToFolder?: () => void
  onLinkToGoal?: () => void
  onPinToSidebar?: () => void
  onExportMarkdown?: () => void
  onCopyLink?: () => void
  onArchive?: () => void
  onDelete?: () => void
  defaultOpen?: boolean
  children: React.ReactNode
}

function Item({ icon, label, hint, danger, onSelect }: { icon: LucideIcon; label: string; hint?: string; danger?: boolean; onSelect?: () => void }) {
  return (
    <DropdownMenu.Item className={menuItemClass} onSelect={onSelect}>
      <MenuItemBody icon={icon} label={label} hint={hint} danger={danger} />
    </DropdownMenu.Item>
  )
}

export function ChatMenu({
  onRename,
  onMoveToFolder,
  onLinkToGoal,
  onPinToSidebar,
  onExportMarkdown,
  onCopyLink,
  onArchive,
  onDelete,
  defaultOpen,
  children,
}: ChatMenuProps) {
  return (
    <DropdownMenu.Root defaultOpen={defaultOpen} modal={false}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side="bottom" align="end" sideOffset={7} alignOffset={4} className={`z-50 w-[240px] ${menuSurface}`}>
          <Item icon={Pencil} label="Rename" hint="F2" onSelect={onRename} />
          <Item icon={FolderInput} label="Move to folder" onSelect={onMoveToFolder} />
          <Item icon={Target} label="Link to goal" onSelect={onLinkToGoal} />
          <Item icon={Pin} label="Pin to sidebar" onSelect={onPinToSidebar} />
          <MenuSeparatorLine />
          <Item icon={FileDown} label="Export as Markdown" onSelect={onExportMarkdown} />
          <Item icon={Link} label="Copy link" hint="⌘L" onSelect={onCopyLink} />
          <MenuSeparatorLine />
          <Item icon={Archive} label="Archive chat" hint="E" onSelect={onArchive} />
          <Item icon={Trash2} label="Delete chat" danger onSelect={onDelete} />
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

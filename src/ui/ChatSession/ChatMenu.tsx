import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Archive,
  ExternalLink,
  FolderOpen,
  Link2,
  MapPin,
  Pencil,
  Target,
  Trash2,
} from 'lucide-react'
import { menuSurface, menuItemClass, MenuSeparatorLine } from '../ds/Menu'

// ── Chat menu (pen ref ERnYB) — the topbar "…" dropdown ──────────────────────

interface ChatMenuProps {
  onRename?: () => void
  onMoveToFolder?: () => void
  onLinkToGoal?: () => void
  onPinToSidebar?: () => void
  onExportMarkdown?: () => void
  onCopyLink?: () => void
  onArchive?: () => void
  onDelete?: () => void
  children: React.ReactNode
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
  children,
}: ChatMenuProps) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          side="bottom"
          align="end"
          sideOffset={6}
          className={`z-50 w-[220px] ${menuSurface}`}
        >
          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onRename}
          >
            <Pencil size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Rename</span>
            <span className="font-mono text-[11px] text-faint">⌘2</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onMoveToFolder}
          >
            <FolderOpen size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Move to folder</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onLinkToGoal}
          >
            <Target size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Link to goal</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onPinToSidebar}
          >
            <MapPin size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Pin to sidebar</span>
          </DropdownMenu.Item>

          <MenuSeparatorLine />

          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onExportMarkdown}
          >
            <ExternalLink size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Export as Markdown</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onCopyLink}
          >
            <Link2 size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Copy link</span>
            <span className="font-mono text-[11px] text-faint">⌘L</span>
          </DropdownMenu.Item>

          <MenuSeparatorLine />

          <DropdownMenu.Item
            className={menuItemClass}
            onSelect={onArchive}
          >
            <Archive size={15} aria-hidden className="text-muted" />
            <span className="flex-1 text-[13px] text-ink">Archive chat</span>
            <span className="font-mono text-[11px] text-faint">⌨</span>
          </DropdownMenu.Item>

          <DropdownMenu.Item
            className={`${menuItemClass} group`}
            onSelect={onDelete}
          >
            <Trash2 size={15} aria-hidden className="text-bad" />
            <span className="flex-1 text-[13px] text-bad">Delete chat</span>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

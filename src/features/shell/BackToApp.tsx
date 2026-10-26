import { useNavigate } from '@tanstack/react-router'
import { ArrowLeft } from 'lucide-react'
import { useUIStore, MODE_HOME } from '../../app/store'

/**
 * Compact "back to the app" row for settings-style sidebars (Notifications,
 * Control Panel) that are reached from the Rail and have no platform nav.
 * Returns to the persisted mode's home so you land back where you were.
 */
export function BackToApp() {
  const navigate = useNavigate()
  const mode = useUIStore((s) => s.mode)
  const label = mode === 'chat' ? 'Back to Chats' : 'Back to Inbox'
  return (
    <button
      type="button"
      aria-label={label}
      onClick={() => void navigate({ to: MODE_HOME[mode] })}
      className="flex w-full shrink-0 items-center gap-[6px] rounded-sm px-[8px] py-[6px] text-left text-[12.5px] font-medium text-muted transition-colors hover:bg-hover hover:text-ink"
    >
      <ArrowLeft size={15} aria-hidden className="shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  )
}

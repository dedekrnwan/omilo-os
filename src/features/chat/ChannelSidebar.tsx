import { useNavigate } from '@tanstack/react-router'
import { useChannels } from '../../app/queries'
import { helperColor, radii } from '../../ui/tokens'

interface ChannelSidebarProps {
  activeChannelId: string | undefined
}

export function ChannelSidebar({ activeChannelId }: ChannelSidebarProps) {
  const { data: channels, isLoading } = useChannels()
  const navigate = useNavigate()

  if (isLoading) {
    return (
      <nav
        aria-label="Channels"
        style={{
          display: 'flex',
          flexDirection: 'column',
          padding: '12px 8px',
          gap: 2,
          color: 'var(--muted)',
          fontSize: 13,
          fontFamily: 'var(--font-sans)',
        }}
      >
        Loading…
      </nav>
    )
  }

  return (
    <nav
      aria-label="Channels"
      style={{
        display: 'flex',
        flexDirection: 'column',
        padding: '12px 8px',
        gap: 2,
        width: 220,
        minWidth: 180,
      }}
    >
      <div
        style={{
          padding: '4px 8px 8px',
          fontSize: 11,
          fontWeight: 600,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          color: 'var(--muted)',
          fontFamily: 'var(--font-sans)',
        }}
      >
        Channels
      </div>

      {channels?.map((channel) => {
        const isActive = channel.id === activeChannelId
        const dotColor = helperColor[channel.area]

        return (
          <button
            key={channel.id}
            aria-current={isActive ? 'true' : undefined}
            onClick={() =>
              navigate({ to: '/chat/$channelId', params: { channelId: channel.id } })
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 10,
              padding: '7px 10px',
              border: 'none',
              borderRadius: radii.sm,
              cursor: 'pointer',
              textAlign: 'left',
              fontFamily: 'var(--font-sans)',
              fontSize: 14,
              fontWeight: isActive ? 600 : 400,
              color: isActive ? 'var(--ink)' : 'var(--ink-2)',
              background: isActive ? 'var(--surface)' : 'transparent',
              boxShadow: isActive ? '0 1px 3px 0 rgba(0,0,0,.08)' : 'none',
              transition: 'background 100ms ease, color 100ms ease',
            }}
            onMouseEnter={(e) => {
              if (!isActive) {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  'var(--hover)'
              }
            }}
            onMouseLeave={(e) => {
              if (!isActive) {
                ;(e.currentTarget as HTMLButtonElement).style.background =
                  'transparent'
              }
            }}
          >
            {/* Area dot */}
            <span
              role="presentation"
              style={{
                flexShrink: 0,
                width: 8,
                height: 8,
                borderRadius: '50%',
                background: dotColor,
              }}
            />

            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {channel.name}
            </span>
          </button>
        )
      })}
    </nav>
  )
}

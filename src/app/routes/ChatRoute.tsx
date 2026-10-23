// Placeholder — Task 7 replaces this component with the real Chat UI.
// Params are declared here so the replacement is a one-line component swap.
import { useParams } from '@tanstack/react-router'

export function ChatRoute() {
  const { channelId, sessionId } = useParams({ strict: false })
  return (
    <div style={{ padding: 16 }}>
      <strong>Chat</strong>
      {channelId && <span> · channel: {channelId}</span>}
      {sessionId && <span> · session: {sessionId}</span>}
    </div>
  )
}

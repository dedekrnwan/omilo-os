// Placeholder — Task 8 replaces this component with the real Office UI.
// Params are declared here so the replacement is a one-line component swap.
import { useParams } from '@tanstack/react-router'

export function OfficeRoute() {
  const { itemId } = useParams({ strict: false })
  return (
    <div style={{ padding: 16 }}>
      <strong>Office / Inbox</strong>
      {itemId && <span> · item: {itemId}</span>}
    </div>
  )
}

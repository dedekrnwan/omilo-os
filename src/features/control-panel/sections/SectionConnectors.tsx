import { Ellipsis, Plus, Server } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Breadcrumb, SectionPane, StatusBadge } from '../ControlPanelShared'
import type { DialogKind } from '../types'

const CONNECTED = [
  { name: 'GitHub', desc: 'saga-bot · org saga', agents: '4 flows · Dev, Ops', permissions: 'Read + open PRs', status: 'ok' as const },
  { name: 'Slack', desc: 'Saga workspace · all agents', agents: null, permissions: 'Posts to #oncall, #eng', status: 'ok' as const },
  { name: 'Gmail', desc: 'hello@sahabatwarga.id · 3 flows · Growth', agents: null, permissions: 'Sending waits for you', status: 'warn' as const, statusLabel: 'Reconnect in 3 days' },
  { name: 'Stripe', desc: 'Sahabat Warga (live) · 1 flow · Finance', agents: null, permissions: 'Read only', status: 'ok' as const },
  { name: 'WhatsApp', desc: '+62 811 2345 678 · 3 flows · Chief, Support', agents: null, permissions: 'Every send waits for you', status: 'ok' as const },
]

const ADD_APPS = [
  { name: 'Google Sheets', desc: 'Read and add rows' },
  { name: 'Notion', desc: 'Read and update pages' },
  { name: 'Instagram', desc: 'Publish posts — waits for you' },
  { name: 'PagerDuty', desc: 'Incidents and on-call' },
  { name: 'Xero', desc: 'Invoices and payments' },
  { name: 'Google Calendar', desc: 'See and create events' },
]

const CONNECTOR_ICONS: Record<string, string> = {
  GitHub: '🐙',
  Slack: '💬',
  Gmail: '✉️',
  Stripe: '💳',
  WhatsApp: '📱',
  'Google Sheets': '📊',
  Notion: '📝',
  Instagram: '📸',
  PagerDuty: '🚨',
  Xero: '💰',
  'Google Calendar': '📅',
}

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionConnectors({ onDialog }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Connectors" />
        <div className="ml-auto flex items-center gap-[8px]">
          <Button variant="primary" height={28} icon={Plus} onClick={() => onDialog('add-mcp')}>
            Add MCP server
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Connectors</h1>
        <p className="mb-[24px] text-[13px] text-muted">Apps your agents can use. Anything that posts, sends or spends still waits for you.</p>

        {/* Connected */}
        <p className="mb-[10px] text-[12px] font-medium uppercase tracking-[0.8px] text-faint">Connected · {CONNECTED.length}</p>
        <div className="mb-[24px] overflow-hidden rounded-lg border border-line-strong bg-surface">
          {CONNECTED.map((c, i) => (
            <div
              key={c.name}
              className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < CONNECTED.length - 1 ? 'border-b border-line' : ''}`}
            >
              <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[16px]">
                {CONNECTOR_ICONS[c.name]}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-semibold text-ink">{c.name}</span>
                <span className="text-[12px] text-muted">{c.desc}</span>
              </div>
              <span className="text-[12px] text-muted">{c.permissions}</span>
              <StatusBadge
                label={c.statusLabel ?? (c.status === 'ok' ? 'Healthy' : 'Warning')}
                color={c.status}
              />
              <button type="button" aria-label={`${c.name} options`} className="flex size-[28px] items-center justify-center rounded-sm text-muted hover:bg-hover">
                <Ellipsis size={14} aria-hidden />
              </button>
            </div>
          ))}
        </div>

        {/* Add an app */}
        <p className="mb-[10px] text-[13px] font-medium text-ink">Add an app</p>
        <div className="mb-[16px] grid grid-cols-3 gap-[10px]">
          {ADD_APPS.map((app) => (
            <div key={app.name} className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-surface px-[14px] py-[10px]">
              <span className="flex size-[28px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[14px]">
                {CONNECTOR_ICONS[app.name] ?? '🔌'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[13px] font-medium text-ink">{app.name}</span>
                <span className="text-[11px] text-muted">{app.desc}</span>
              </div>
              <Button variant="secondary" height={28}>Connect</Button>
            </div>
          ))}
        </div>

        {/* MCP callout */}
        <div className="flex items-center gap-[10px] rounded-lg border border-line-strong bg-soft px-[14px] py-[10px]">
          <Server size={14} className="text-muted" aria-hidden />
          <span className="text-[12.5px] text-muted">
            Need something else?{' '}
            <button type="button" onClick={() => onDialog('add-mcp')} className="text-link hover:underline">Add an MCP server or a webhook</button>
            {' '}— agents get the same approval rules.
          </span>
        </div>
      </SectionPane>
    </div>
  )
}

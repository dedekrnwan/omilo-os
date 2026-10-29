// ── Shared primitives used across Office Flows screens ────────────────────────

import type { FlowRunStatus, NodeKind } from './data'

// ── Run status style map ──────────────────────────────────────────────────────

export const RUN_STATUS_STYLE: Record<FlowRunStatus, { bg: string; ink: string }> = {
  Running:      { bg: 'var(--color-info-tint)',  ink: 'var(--color-info)' },
  'Needs you':  { bg: '#EB68341A',               ink: '#C2410C' },
  Done:         { bg: 'var(--color-ok-tint)',    ink: 'var(--color-ok)' },
  Failed:       { bg: 'var(--color-bad-tint)',   ink: 'var(--color-bad)' },
}

// ── Sparkline ─────────────────────────────────────────────────────────────────

/** 7-day run sparkline; `bars` are pre-scaled to 0–5 (see boardStore.sparkBars). */
export function Sparkline({ bars }: { bars: number[] }) {
  const max = 5
  const barW = 4
  const h = 20
  return (
    <div className="flex items-end gap-[2px]" aria-hidden style={{ height: h }}>
      {bars.map((v, i) => {
        const pct = v / max
        const barH = Math.max(3, Math.round(pct * h))
        // 0 = no runs that day: a faint stub, not a "bad" bar.
        const color =
          v === 0
            ? 'var(--color-line-strong)'
            : pct > 0.7
            ? 'var(--color-ok)'
            : pct > 0.4
            ? 'var(--color-helper-marketing)'
            : 'var(--color-bad-solid)'
        return (
          <span
            key={i}
            style={{ width: barW, height: barH, background: color, borderRadius: 2, display: 'block' }}
          />
        )
      })}
    </div>
  )
}

// ── Toggle switch ─────────────────────────────────────────────────────────────

export function Toggle({ on }: { on: boolean }) {
  return (
    <span
      role="switch"
      aria-checked={on}
      className="relative inline-flex h-[16px] w-[28px] shrink-0 cursor-pointer items-center rounded-pill transition-colors"
      style={{ background: on ? 'var(--color-helper-brand)' : 'var(--color-line-strong)' }}
    >
      <span
        className="absolute size-[12px] rounded-full bg-white shadow-sm transition-transform"
        style={{ transform: on ? 'translateX(14px)' : 'translateX(2px)' }}
      />
    </span>
  )
}

// ── Status chip ───────────────────────────────────────────────────────────────

export function RunStatusChip({ status }: { status: FlowRunStatus }) {
  const st = RUN_STATUS_STYLE[status]
  return (
    <span
      className="inline-flex h-[20px] items-center rounded-pill px-[8px] text-[11.5px] font-medium whitespace-nowrap"
      style={{ background: st.bg, color: st.ink }}
    >
      {status}
    </span>
  )
}

// ── Canvas node color map ─────────────────────────────────────────────────────

export const NODE_COLORS: Record<NodeKind, { border: string; bg: string; badge: string; badgeText: string }> = {
  trigger: {
    border: 'var(--color-line-strong)',
    bg: 'var(--color-surface)',
    badge: 'var(--color-warn-tint)',
    badgeText: 'var(--color-warn)',
  },
  'ai-step': {
    border: '#6366F129',
    bg: '#6366F108',
    badge: '#6366F120',
    badgeText: '#6366F1',
  },
  connector: {
    border: '#0EA5E929',
    bg: '#0EA5E908',
    badge: '#0EA5E920',
    badgeText: '#0EA5E9',
  },
  approval: {
    border: '#F9731629',
    bg: '#F9731608',
    badge: '#F9731620',
    badgeText: '#F97316',
  },
  condition: {
    border: 'var(--color-line-strong)',
    bg: 'var(--color-soft)',
    badge: 'var(--color-hover)',
    badgeText: 'var(--color-muted)',
  },
}

export const NODE_KIND_LABEL: Record<NodeKind, string> = {
  trigger:   'TRIGGER · GitHub',
  'ai-step': 'AI STEP · Ops',
  connector: 'CONNECTOR · Chat',
  approval:  'APPROVAL · Inbox',
  condition: 'IF',
}

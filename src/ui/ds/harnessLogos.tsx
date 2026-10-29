/**
 * Harness brand marks — compact, brand-approximate inline SVG logos for the
 * coding-assistant harnesses Omilo can pool. Rendered as a glyph on a
 * transparent background (callers wrap in a tile). Not official trademarks —
 * recognizable product marks.
 */
import { useId } from 'react'
import type { HarnessId } from '../../features/control-panel/harnesses'

function Claude({ size }: { size: number }) {
  // Anthropic/Claude coral sunburst.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="img">
      <g fill="#D97757">
        {Array.from({ length: 12 }).map((_, i) => (
          <rect key={i} x="11.2" y="2.2" width="1.6" height="9.3" rx="0.8" transform={`rotate(${i * 30} 12 12)`} />
        ))}
      </g>
    </svg>
  )
}

function OpenCode({ size }: { size: number }) {
  // Terminal glyph: rounded square + ">_".
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="img">
      <rect x="3" y="4.5" width="18" height="15" rx="4" fill="none" stroke="#1C1917" strokeWidth="1.6" />
      <path d="M8 10.5l2.6 2.2L8 14.9" fill="none" stroke="#1C1917" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12.8 15h3.4" stroke="#1C1917" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  )
}

function Codex({ size }: { size: number }) {
  // OpenAI blossom — three interlocking rings.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="img">
      <g fill="none" stroke="#0C0A09" strokeWidth="1.5">
        <ellipse cx="12" cy="12" rx="9" ry="3.6" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(60 12 12)" />
        <ellipse cx="12" cy="12" rx="9" ry="3.6" transform="rotate(120 12 12)" />
      </g>
    </svg>
  )
}

function Copilot({ size }: { size: number }) {
  // GitHub Copilot — goggled head with antenna.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="img">
      <g fill="none" stroke="#0C0A09" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4.5 13c0-3 2.4-4.6 7.5-4.6s7.5 1.6 7.5 4.6v2.2c0 2.3-3 3.8-7.5 3.8s-7.5-1.5-7.5-3.8z" />
        <path d="M12 8.2V6.4a2 2 0 0 1 2-2" />
      </g>
      <g fill="#0C0A09">
        <ellipse cx="9" cy="14" rx="1.5" ry="2" />
        <ellipse cx="15" cy="14" rx="1.5" ry="2" />
      </g>
    </svg>
  )
}

function Gemini({ size }: { size: number }) {
  // Google Gemini four-point spark with blue→purple gradient.
  const id = useId()
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="img">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#4285F4" />
          <stop offset="0.55" stopColor="#7C6CF0" />
          <stop offset="1" stopColor="#9B72F2" />
        </linearGradient>
      </defs>
      <path d="M12 2c.7 5.2 4.1 8.6 10 9.3-5.9.7-9.3 4.1-10 10-.7-5.9-4.1-9.3-10-10 5.9-.7 9.3-4.1 10-9.3z" fill={`url(#${id})`} />
    </svg>
  )
}

function Cursor({ size }: { size: number }) {
  // Cursor — angular cursor mark.
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden role="img">
      <path d="M12 2.5l9.2 5.3v8.4L12 21.5 2.8 16.2V7.8z" fill="none" stroke="#0C0A09" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 2.5v9.2l9.2 4.5" fill="none" stroke="#0C0A09" strokeWidth="1.4" strokeLinejoin="round" />
      <path d="M12 11.7L2.8 7.8" fill="none" stroke="#0C0A09" strokeWidth="1.4" strokeLinejoin="round" />
    </svg>
  )
}

const LOGOS: Record<HarnessId, (p: { size: number }) => React.ReactNode> = {
  'claude-code': Claude,
  opencode: OpenCode,
  codex: Codex,
  copilot: Copilot,
  'gemini-cli': Gemini,
  cursor: Cursor,
}

/** Render a harness brand mark. Falls back to nothing for unknown ids. */
export function HarnessLogo({ id, size = 20 }: { id: string; size?: number }) {
  const Logo = LOGOS[id as HarnessId]
  return Logo ? <Logo size={size} /> : null
}

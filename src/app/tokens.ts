/**
 * AI usage is counted in tokens (input + output) — the unit for every AI
 * budget and limit (company, role, helper, per task, per flow run). AI is
 * billed per token by the company's own provider today, and by Omilo's AI
 * partner later.
 */

/** 1240000 → "1.2M", 41200 → "41k", 950 → "950". */
export function formatTokens(n: number): string {
  const v = Math.max(0, Math.round(n || 0))
  if (v >= 1_000_000) return `${(v / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (v >= 1000) return `${Math.round(v / 1000)}k`
  return String(v)
}

/** "1.2M tokens" / "1 token" */
export function tokensLabel(n: number): string {
  return `${formatTokens(n)} ${Math.round(n) === 1 ? 'token' : 'tokens'}`
}

/**
 * Read a token amount someone typed: "2M", "500k", "1.5m", "2.000.000", "250000".
 * Returns null for empty / zero / unreadable input (= no limit).
 */
export function parseTokens(input: string): number | null {
  const s = (input || '').trim().toLowerCase().replace(/\s|tokens?|tok/g, '')
  if (!s) return null
  const m = s.match(/^(\d+(?:[.,]\d+)?)(k|rb|m|jt|b)?$/)
  let n: number
  if (m && m[2]) {
    const mult = m[2] === 'k' || m[2] === 'rb' ? 1e3 : m[2] === 'b' ? 1e9 : 1e6
    n = parseFloat(m[1].replace(',', '.')) * mult
  } else {
    n = Number(s.replace(/[.,]/g, ''))
  }
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null
}

/** Exact input value for a stored limit: 2000000 → "2M", 250000 → "250k", 1500 → "1500". */
export function tokensInput(n: number | null | undefined): string {
  if (!n || n <= 0) return ''
  const v = Math.round(n)
  if (v >= 1_000_000 && v % 100_000 === 0) return `${v / 1_000_000}M`
  if (v % 1_000 === 0) return `${v / 1_000}k`
  return String(v)
}

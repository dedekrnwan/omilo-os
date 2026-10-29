/** Formatting + browser helpers shared by control-panel sections. */

/** Rupiah in the short form the designs use: "Rp 150 rb", "Rp 2 jt", "Rp 2,3 jt". */
export function formatIdrShort(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const trim = (v: number) => (Number.isInteger(v) ? String(v) : v.toFixed(1).replace('.', ','))
  if (abs >= 1_000_000) return `Rp ${trim(Math.round((n / 1_000_000) * 10) / 10)} jt`
  if (abs >= 1_000) return `Rp ${trim(Math.round((n / 1_000) * 10) / 10)} rb`
  return `Rp ${n}`
}

/** Full rupiah: "Rp 200.000". */
export function formatIdr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return ''
  return `Rp ${Math.round(n).toLocaleString('id-ID')}`
}

/** Parse "Rp 200.000" / "200000" / "2jt" → integer rupiah (null when empty). */
export function parseIdr(text: string): number | null {
  const t = text.trim().toLowerCase()
  if (!t) return null
  const mult = /jt|juta/.test(t) ? 1_000_000 : /rb|ribu|k\b/.test(t) ? 1_000 : 1
  if (mult > 1) {
    const num = parseFloat(t.replace(/[^0-9,.]/g, '').replace(',', '.'))
    return Number.isFinite(num) ? Math.round(num * mult) : null
  }
  const digits = t.replace(/[^0-9]/g, '')
  return digits ? parseInt(digits, 10) : null
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null || !Number.isFinite(bytes)) return '—'
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`
  return `${bytes} B`
}

/** "active now", "active 2h ago", "active Yesterday", "active Oct 3". */
export function lastSeenLabel(iso: string | null | undefined, now: Date = new Date()): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  const mins = Math.round((now.getTime() - t.getTime()) / 60_000)
  if (mins < 10) return 'active now'
  if (mins < 60) return `active ${mins}m ago`
  const hours = Math.round(mins / 60)
  if (hours < 24 && t.getDate() === now.getDate()) return `active ${hours}h ago`
  const yesterday = new Date(now)
  yesterday.setDate(now.getDate() - 1)
  if (t.toDateString() === yesterday.toDateString()) return 'active Yesterday'
  return `active ${t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}`
}

export function shortDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const t = new Date(iso)
  if (Number.isNaN(t.getTime())) return ''
  return t.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export function initialsOf(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

const PALETTE = ['#57534E', '#0EA5E9', '#14B8A6', '#F97316', '#8B5CF6', '#EC4899', '#10B981', '#F59E0B']
export function colorFor(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0
  return PALETTE[h % PALETTE.length]
}

/** Read an image file as a data: URL (≤ 512 KB, the backend limit). */
export function fileToDataUrl(file: File, maxBytes = 512 * 1024): Promise<string> {
  if (file.size > maxBytes) return Promise.reject(new Error('Images must be 512 KB or smaller.'))
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result))
    reader.onerror = () => reject(new Error('Could not read that file.'))
    reader.readAsDataURL(file)
  })
}

/** Trigger a browser download for a blob. */
export function saveBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** Open a hosted checkout in a new tab; fall back to same-tab navigation. */
export function openCheckout(url: string): void {
  const w = window.open(url, '_blank', 'noopener')
  if (!w) window.location.assign(url)
}

export function errorMessage(e: unknown, fallback: string): string {
  return e instanceof Error && e.message ? e.message : fallback
}

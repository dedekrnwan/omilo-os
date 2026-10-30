/** Rupiah formatting (plan prices, invoices). AI usage is counted in tokens: see ./tokens. */

const nf = new Intl.NumberFormat('id-ID')

/** "Rp 21.750" */
export function formatRp(n: number): string {
  return `Rp ${nf.format(Math.round(n))}`
}

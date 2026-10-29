/**
 * Credits ↔ Rupiah — one rate for the whole app.
 *
 * Mirrors ``IDR_PER_CREDIT`` in apps/api/omilo/billing/catalog.py: the base
 * credit pack is 2,000 credits for Rp 100 rb, i.e. Rp 50 per credit. Spend is
 * stored in credits everywhere; screens show credits and/or the Rupiah
 * equivalent at this rate.
 */
export const IDR_PER_CREDIT = 50

const nf = new Intl.NumberFormat('id-ID')

/** "1.450 cr" */
export function formatCredits(n: number): string {
  return `${nf.format(Math.round(n))} cr`
}

/** "Rp 21.750" */
export function formatRp(n: number): string {
  return `Rp ${nf.format(Math.round(n))}`
}

/** Rupiah value of a credit amount. */
export function creditsToIdr(credits: number): number {
  return credits * IDR_PER_CREDIT
}

/** Credits for a Rupiah amount (rounded up so a cap is never undershot by rounding). */
export function idrToCredits(idr: number): number {
  return Math.ceil(idr / IDR_PER_CREDIT)
}

/** "≈ Rp 21.750" for a credit amount. */
export function creditsInRp(credits: number): string {
  return `≈ ${formatRp(creditsToIdr(credits))}`
}

/** Compact cost label for a run/job: "Rp 600" (credits shown in the title attr by callers). */
export function costLabel(credits: number): string {
  return formatRp(creditsToIdr(credits))
}

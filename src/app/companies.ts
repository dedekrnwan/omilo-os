/** Companies (workspaces) the person belongs to — mock until the API lands. */
export const COMPANIES = [
  { id: 'sahabat-warga', name: 'Sahabat Warga', initial: 'S', color: '#EB6834' },
  { id: 'kopi-kenangan', name: 'Kopi Kenangan', initial: 'K', color: '#6366F1', badge: true },
] as const

export type CompanyRecord = (typeof COMPANIES)[number]

/**
 * Choose company — /auth/choose-company (ref: Ltj2k)
 * Shown when a user belongs to multiple companies and needs to pick one to open.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout } from './AuthLayout'

interface Company {
  initial: string
  color: string
  name: string
  role: string
  members: number
  hint: string
  active?: boolean
}

const COMPANIES: Company[] = [
  {
    initial: 'S',
    color: '#F97316',
    name: 'Sahabat Warga',
    role: 'Owner',
    members: 4,
    hint: 'opened today',
    active: true,
  },
  {
    initial: 'K',
    color: '#14B8A6',
    name: 'Kopi Kenangan',
    role: 'Admin',
    members: 12,
    hint: '3 need you',
  },
]

function CompanyRow({ company }: { company: Company }) {
  return (
    <button
      type="button"
      style={{
        width: '100%',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px',
        border: company.active ? '1.5px solid #171717' : '1px solid #E7E5E4',
        borderRadius: 10,
        background: '#FFFFFF',
        cursor: 'pointer',
        fontFamily: 'inherit',
        textAlign: 'left',
        transition: 'border-color 0.15s',
      }}
    >
      {/* Company logo */}
      <span style={{
        width: 36,
        height: 36,
        borderRadius: 9,
        background: company.color,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        fontWeight: 700,
        color: '#FFFFFF',
        flexShrink: 0,
      }}>
        {company.initial}
      </span>

      {/* Info */}
      <div style={{ flex: 1 }}>
        <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600, color: '#0C0A09' }}>
          {company.name}
        </p>
        <p style={{ margin: 0, fontSize: 12, color: '#78716C' }}>
          {company.role} · {company.members} members · {company.hint}
        </p>
      </div>

      {/* Arrow */}
      <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
        <path d="M6 4l4 4-4 4" stroke="#A8A29E" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
      </svg>
    </button>
  )
}

export function ChooseCompanyPage() {
  return (
    <AuthLayout>
      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Welcome back, Dede
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        Pick a company to open. You can switch any time from the rail.
      </p>

      {/* Company list */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginBottom: 16 }}>
        {COMPANIES.map((c) => (
          <CompanyRow key={c.name} company={c} />
        ))}

        {/* Create new company row */}
        <button
          type="button"
          style={{
            width: '100%',
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '14px 16px',
            border: '1px solid #E7E5E4',
            borderRadius: 10,
            background: '#FFFFFF',
            cursor: 'pointer',
            fontFamily: 'inherit',
            textAlign: 'left',
          }}
        >
          <span style={{
            width: 36,
            height: 36,
            borderRadius: 9,
            border: '1.5px dashed #D6D3D1',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 20,
            color: '#A8A29E',
            flexShrink: 0,
          }}>
            +
          </span>
          <div style={{ flex: 1 }}>
            <p style={{ margin: '0 0 2px', fontSize: 13.5, fontWeight: 600, color: '#0C0A09' }}>
              Create a new company
            </p>
            <p style={{ margin: 0, fontSize: 12, color: '#78716C' }}>
              Chief helps you set it up in about 5 minutes
            </p>
          </div>
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
            <path d="M6 4l4 4-4 4" stroke="#A8A29E" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round"/>
          </svg>
        </button>
      </div>

      {/* Account footer */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#78716C' }}>
        <svg width={16} height={16} viewBox="0 0 16 16" aria-hidden>
          <path fill="#4285F4" d="M15.68 8.18c0-.57-.05-1.12-.15-1.65H8v3.12h4.36a3.73 3.73 0 0 1-1.62 2.44v2.03h2.62c1.53-1.41 2.41-3.48 2.41-5.94z"/>
          <path fill="#34A853" d="M8 16c2.16 0 3.97-.72 5.3-1.95l-2.62-2.03c-.72.48-1.64.77-2.68.77-2.06 0-3.8-1.39-4.42-3.26H.87v2.08A8 8 0 0 0 8 16z"/>
          <path fill="#FBBC05" d="M3.58 9.53A4.87 4.87 0 0 1 3.32 8c0-.53.09-1.05.26-1.53V4.39H.87A8 8 0 0 0 0 8c0 1.3.31 2.54.87 3.61l2.71-2.08z"/>
          <path fill="#EA4335" d="M8 3.18c1.19 0 2.26.41 3.1 1.21l2.32-2.32A8 8 0 0 0 .87 4.4l2.71 2.08A4.78 4.78 0 0 1 8 3.18z"/>
        </svg>
        <span>dede@saga.co.id</span>
        <span>·</span>
        <a href="#" style={{ color: '#2563EB', textDecoration: 'none' }}>Switch account</a>
      </div>
    </AuthLayout>
  )
}

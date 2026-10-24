/**
 * Accept invite — /auth/invite (ref: kIAtu)
 * Shown when following an invite link to join a company as a Member.
 * Standalone full-screen page. No Shell / Rail.
 */

import { AuthLayout, MascotBlob } from './AuthLayout'
import { GoogleLogo, AuthButton } from './AuthPrimitives'

/** Two overlapping avatar initials bubbles (inviter + company) */
function InviteAvatars() {
  return (
    <div style={{ display: 'flex', marginBottom: 20 }}>
      {/* Inviter avatar */}
      <span style={{
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: '#E0E7FF',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 14,
        fontWeight: 700,
        color: '#4338CA',
        border: '2px solid #FFFFFF',
        zIndex: 1,
        flexShrink: 0,
      }}>
        RA
      </span>
      {/* Company mascot */}
      <span style={{ marginLeft: -10, zIndex: 0 }}>
        <MascotBlob color="#F97316" size={40} style={{ border: '2px solid #FFFFFF', borderRadius: '50%' }} />
      </span>
    </div>
  )
}

function DetailRow({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div style={{
      display: 'flex',
      justifyContent: 'space-between',
      alignItems: 'center',
      padding: '10px 0',
      borderBottom: '1px solid #F5F5F4',
      fontSize: 13.5,
    }}>
      <span style={{ color: '#78716C' }}>{label}</span>
      <span style={{ color: '#0C0A09', fontWeight: 500 }}>{value}</span>
    </div>
  )
}

/** 3 agent mascots stacked */
function AgentStack() {
  const colors = ['#6366F1', '#0EA5E9', '#65A30D']
  return (
    <div style={{ display: 'flex' }}>
      {colors.map((c, i) => (
        <span key={i} style={{ marginLeft: i === 0 ? 0 : -8, zIndex: colors.length - i }}>
          <MascotBlob color={c} size={24} />
        </span>
      ))}
    </div>
  )
}

export function AcceptInvitePage() {
  return (
    <AuthLayout>
      <InviteAvatars />

      <h1 style={{ margin: '0 0 6px', fontSize: 22, fontWeight: 700, color: '#0C0A09', fontFamily: 'var(--font-display, sans-serif)' }}>
        Rina invited you to Sahabat Warga
      </h1>
      <p style={{ margin: '0 0 24px', fontSize: 13.5, color: '#78716C' }}>
        You'll join as a Member. Sign in with and@saga.co.id to accept.
      </p>

      {/* Details card */}
      <div style={{
        border: '1px solid #E7E5E4',
        borderRadius: 10,
        background: '#FAFAF9',
        padding: '0 16px',
        marginBottom: 20,
      }}>
        <DetailRow label="Role" value="Member" />
        <DetailRow label="Channels" value="Business, General" />
        <DetailRow
          label="Agents you'll work with"
          value={<AgentStack />}
        />
      </div>

      {/* Accept actions */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <AuthButton variant="secondary">
          <GoogleLogo size={18} />
          Accept with Google
        </AuthButton>
        <AuthButton variant="secondary">
          <svg width={16} height={16} viewBox="0 0 16 16" fill="none" aria-hidden>
            <rect x={1} y={3} width={14} height={10} rx={2} stroke="#44403C" strokeWidth={1.5}/>
            <path d="M1 6l7 4 7-4" stroke="#44403C" strokeWidth={1.5}/>
          </svg>
          Accept with an email code
        </AuthButton>
      </div>

      <p style={{ marginTop: 16, textAlign: 'center', fontSize: 12.5, color: '#A8A29E' }}>
        Invite expires in 6 days
      </p>
    </AuthLayout>
  )
}

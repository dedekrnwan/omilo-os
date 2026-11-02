/**
 * Onboarding 3 · Your company (industry, teamSize, region, currency, picRole).
 *
 * Sits between know-you and check. Shares the Check step's visual language —
 * Mascot + title header, a flex-row grid of bg-surface cards with an IconTile
 * and a Stroke border — so it reads as part of the same wizard, not a bare
 * form. Chief prefills what it can infer from the interview (getProfileSuggestion);
 * the owner confirms or edits. On valid submit, PATCH /v1/company via
 * updateCompanyProfile, then advance.
 */
import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Building2, Coins, Globe, Sparkles, UserRound, Users } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { IconTile, PrimaryButton, QuietButton, Stroke, WizardCard } from './parts'
import { createCommands } from '../../adapters/http/commands'
import { getProfileSuggestion } from './interviewApi'
import { platform } from '../../platform'

// ── commands factory (mirrors ChatSession.tsx pattern) ────────────────────────

const BASE_URL = (import.meta as { env?: Record<string, string> }).env?.VITE_API_URL ?? 'http://localhost:8000'
function getToken(): string | null {
  return platform.tokenStorage.getToken()
}

// ── field option sets ─────────────────────────────────────────────────────────

const TEAM_SIZES = ['1-10', '11-50', '51-200', '200+'] as const
const REGIONS = ['Indonesia', 'Southeast Asia', 'Global'] as const
const CURRENCIES = ['IDR', 'USD', 'SGD', 'MYR'] as const

// ── sub-components ────────────────────────────────────────────────────────────

/** Shared input/select styling — the card-internal field, matching the Check step's note editor. */
const FIELD_CLS =
  'h-[36px] w-full min-w-0 rounded-base bg-surface px-[10px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-2 focus:outline-primary placeholder:text-faint'

/** Marks a field Chief prefilled from the interview, so the owner knows to check it. */
function PrefillTag() {
  return (
    <span
      title="Filled in from your chat with Chief"
      className="flex shrink-0 items-center gap-[3px] text-[11px] font-medium whitespace-nowrap text-info"
    >
      <Sparkles size={11} aria-hidden />
      from your chat
    </span>
  )
}

/** One field as a card, in the Check step's language: IconTile + label + input + Stroke border. */
function FieldCard({
  icon,
  label,
  prefilled,
  error,
  children,
}: {
  icon: LucideIcon
  label: string
  prefilled?: boolean
  error?: string
  children: React.ReactNode
}) {
  return (
    <article className="relative flex min-w-0 flex-col gap-[10px] rounded-md bg-surface p-[14px]">
      <div className="flex w-full items-center gap-[8px]">
        <IconTile icon={icon} />
        <h3 className="truncate text-[14px] font-semibold whitespace-nowrap text-ink">{label}</h3>
        <span className="h-px flex-1" />
        {prefilled && <PrefillTag />}
      </div>
      {children}
      {error && (
        <span role="alert" className="text-[12px] font-medium text-danger">
          {error}
        </span>
      )}
      <Stroke />
    </article>
  )
}

// ── main component ────────────────────────────────────────────────────────────

interface ProfileForm {
  industry: string
  teamSize: string
  region: string
  currency: string
  picRole: string
}

interface ProfileErrors {
  industry?: string
  teamSize?: string
  region?: string
  currency?: string
  picRole?: string
}

export interface ProfileData {
  industry: string
  teamSize: string
  region: string
  currency: string
  picRole: string
}

export function StepProfile({
  onNext,
  onBack,
  onProfileChange,
}: {
  onNext: () => void
  onBack?: () => void
  onProfileChange?: (data: ProfileData) => void
}) {
  const [form, setForm] = useState<ProfileForm>({
    industry: '',
    teamSize: '',
    region: '',
    currency: 'IDR',
    picRole: '',
  })
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [saving, setSaving] = useState(false)
  // Fields Chief prefilled from the interview — shown with a subtle marker so
  // the owner knows what to double-check. User edits clear the marker.
  const [prefilled, setPrefilled] = useState<Set<keyof ProfileForm>>(new Set())

  // On mount, ask Chief to infer the profile from the interview notes and
  // prefill whatever it's confident about. Best-effort: a failed/empty
  // suggestion just leaves the form at its defaults (see getProfileSuggestion).
  useEffect(() => {
    let alive = true
    getProfileSuggestion().then((s) => {
      if (!alive) return
      const filled = new Set<keyof ProfileForm>()
      setForm((f) => {
        const next = { ...f }
        ;(['industry', 'teamSize', 'region', 'currency', 'picRole'] as const).forEach((k) => {
          // Only prefill fields the owner hasn't touched. Currency defaults to
          // 'IDR', so let a grounded suggestion override that default too.
          const untouched = !f[k] || (k === 'currency' && f[k] === 'IDR')
          if (s[k] && untouched) {
            next[k] = s[k]
            filled.add(k)
          }
        })
        return next
      })
      setPrefilled(filled)
    })
    return () => {
      alive = false
    }
  }, [])

  function set(field: keyof ProfileForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
    // The owner edited this field — it's their value now, not Chief's guess.
    setPrefilled((p) => {
      if (!p.has(field)) return p
      const next = new Set(p)
      next.delete(field)
      return next
    })
  }

  function validate(): ProfileErrors {
    const e: ProfileErrors = {}
    if (!form.industry.trim()) e.industry = 'Industry is required'
    if (!form.teamSize) e.teamSize = 'Team size is required'
    if (!form.region) e.region = 'Region is required'
    if (!form.currency) e.currency = 'Currency is required'
    if (!form.picRole.trim()) e.picRole = 'Your role is required'
    return e
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    const errs = validate()
    if (Object.keys(errs).length > 0) {
      setErrors(errs)
      return
    }
    setSaving(true)
    try {
      const commands = createCommands(BASE_URL, getToken)
      const profileData: ProfileData = {
        industry: form.industry.trim(),
        teamSize: form.teamSize,
        region: form.region,
        currency: form.currency,
        picRole: form.picRole.trim(),
      }
      await commands.updateCompanyProfile(profileData)
      onProfileChange?.(profileData)
      onNext()
    } finally {
      setSaving(false)
    }
  }

  return (
    <WizardCard stack>
      {/* Header — same Mascot + title language as the Check step */}
      <div className="flex w-full items-center gap-[14px]">
        <Mascot helper area="brand" size={44} radius={12} title="Chief of Staff" />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <h1 className="font-display text-[26px] font-semibold tracking-[-0.4px] text-ink">
            A bit about your company
          </h1>
          <p className="text-[14px] text-muted">
            This helps your team work in the right context — currency, region, and team shape.
          </p>
        </div>
      </div>

      <form
        id="profile-form"
        onSubmit={handleSubmit}
        noValidate
        className="grid w-full grid-cols-1 gap-[12px] sm:grid-cols-2 lg:grid-cols-3"
      >
        <FieldCard icon={Building2} label="Industry" prefilled={prefilled.has('industry')} error={errors.industry}>
          <input
            id="field-industry"
            type="text"
            aria-label="Industry"
            placeholder="e.g. Fintech, Healthcare, Gov-tech…"
            value={form.industry}
            onChange={(e) => set('industry', e.target.value)}
            aria-describedby={errors.industry ? 'err-industry' : undefined}
            className={FIELD_CLS}
          />
        </FieldCard>
        <FieldCard icon={Users} label="Team size" prefilled={prefilled.has('teamSize')} error={errors.teamSize}>
          <select
            id="field-teamsize"
            aria-label="Team size"
            value={form.teamSize}
            onChange={(e) => set('teamSize', e.target.value)}
            className={FIELD_CLS}
          >
            <option value="">Select team size…</option>
            {TEAM_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        </FieldCard>
        <FieldCard icon={Globe} label="Region" prefilled={prefilled.has('region')} error={errors.region}>
          <select
            id="field-region"
            aria-label="Region"
            value={form.region}
            onChange={(e) => set('region', e.target.value)}
            className={FIELD_CLS}
          >
            <option value="">Select region…</option>
            {REGIONS.map((r) => (
              <option key={r} value={r}>
                {r}
              </option>
            ))}
          </select>
        </FieldCard>
        <FieldCard icon={Coins} label="Currency" prefilled={prefilled.has('currency')} error={errors.currency}>
          <select
            id="field-currency"
            aria-label="Currency"
            value={form.currency}
            onChange={(e) => set('currency', e.target.value)}
            className={FIELD_CLS}
          >
            {CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
        </FieldCard>
        <FieldCard icon={UserRound} label="Your role" prefilled={prefilled.has('picRole')} error={errors.picRole}>
          <input
            id="field-picrole"
            type="text"
            aria-label="Your role"
            placeholder="e.g. Ops Lead, Founder, CTO…"
            value={form.picRole}
            onChange={(e) => set('picRole', e.target.value)}
            aria-describedby={errors.picRole ? 'err-picrole' : undefined}
            className={FIELD_CLS}
          />
        </FieldCard>
        {/* Note card — fills the third slot, carries the prefill + editable-later message. */}
        <div className="relative flex min-w-0 flex-col items-start justify-center gap-[6px] rounded-md p-[14px]">
          {prefilled.size > 0 ? (
            <span className="flex items-start gap-[6px] text-[12px] leading-[1.5] text-muted">
              <Sparkles size={13} aria-hidden className="mt-[2px] shrink-0 text-info" />
              Chief filled some of this in from your chat — check it’s right. You can change everything later in
              Company settings.
            </span>
          ) : (
            <span className="text-[12px] leading-[1.5] text-muted">
              You can change all of this later in Company settings.
            </span>
          )}
          <Stroke color="var(--color-wire-strong)" />
        </div>
      </form>

      <div className="w-full flex-1" />

      {/* Footer — mirrors the Check step */}
      <div className="flex w-full items-center gap-[10px]">
        {onBack && (
          <QuietButton icon={ArrowLeft} onClick={onBack}>
            Back to our chat
          </QuietButton>
        )}
        <span className="h-px flex-1" />
        <PrimaryButton
          icon={ArrowRight}
          onClick={() => void handleSubmit(new Event('submit') as unknown as React.FormEvent)}
        >
          {saving ? 'Saving…' : 'Continue'}
        </PrimaryButton>
      </div>
    </WizardCard>
  )
}

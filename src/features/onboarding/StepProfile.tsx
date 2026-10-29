/**
 * Onboarding 3b · Company profile (industry, teamSize, region, currency, picRole).
 *
 * Placed between know-you and check in the wizard flow.
 * Mirrors the onboarding's visual language: WizardCard, Mascot ChiefSays header,
 * token classes (text-ink, bg-surface, border/line, text-[12px]).
 * On valid submit calls PATCH /v1/company via updateCompanyProfile then advances.
 */
import { useState } from 'react'
import { ArrowRight, Building2 } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { PrimaryButton, Stroke, WizardCard } from './parts'
import { createCommands } from '../../adapters/http/commands'
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

function FieldLabel({ htmlFor, children }: { htmlFor: string; children: React.ReactNode }) {
  return (
    <label htmlFor={htmlFor} className="w-[108px] shrink-0 text-[13px] font-medium text-ink-2 sm:w-[140px]">
      {children}
    </label>
  )
}

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <span id={id} role="alert" className="mt-[4px] pl-[148px] text-[12px] font-medium text-danger">
      {message}
    </span>
  )
}

function FieldRow({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex w-full flex-col">
      <div className="flex w-full items-center gap-[8px]">{children}</div>
    </div>
  )
}

/** Shared input class that matches the onboarding's existing input styling. */
const INPUT_CLS =
  'h-[36px] min-w-0 flex-1 rounded-btn bg-surface px-[12px] text-[13px] text-ink outline-1 -outline-offset-1 outline-line-strong focus:outline-2 focus:-outline-offset-2 focus:outline-primary placeholder:text-faint'

/** Shared select class. */
const SELECT_CLS = INPUT_CLS

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

export function StepProfile({ onNext, onProfileChange }: { onNext: () => void; onProfileChange?: (data: ProfileData) => void }) {
  const [form, setForm] = useState<ProfileForm>({
    industry: '',
    teamSize: '',
    region: '',
    currency: 'IDR',
    picRole: '',
  })
  const [errors, setErrors] = useState<ProfileErrors>({})
  const [saving, setSaving] = useState(false)

  function set(field: keyof ProfileForm, value: string) {
    setForm((f) => ({ ...f, [field]: value }))
    if (errors[field]) setErrors((e) => ({ ...e, [field]: undefined }))
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
    <WizardCard className="flex-col gap-[24px] px-[20px] py-[24px] sm:px-[40px] sm:py-[32px] lg:overflow-y-auto">
      {/* Header — mirrors StepCheck's Mascot + title pattern */}
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

      {/* Form */}
      <form
        id="profile-form"
        onSubmit={handleSubmit}
        noValidate
        className="relative flex w-full flex-col gap-[14px] rounded-md bg-soft p-[24px]"
      >
        <Stroke color="var(--color-line)" />

        {/* Industry */}
        <div className="flex w-full flex-col gap-[4px]">
          <FieldRow>
            <FieldLabel htmlFor="field-industry">
              <span className="flex items-center gap-[6px]">
                <Building2 size={13} aria-hidden className="text-muted" />
                Industry
              </span>
            </FieldLabel>
            <input
              id="field-industry"
              type="text"
              aria-label="Industry"
              placeholder="e.g. Fintech, Healthcare, Gov-tech…"
              value={form.industry}
              onChange={(e) => set('industry', e.target.value)}
              aria-describedby={errors.industry ? 'err-industry' : undefined}
              className={INPUT_CLS}
            />
          </FieldRow>
          {errors.industry && <FieldError id="err-industry" message={errors.industry} />}
        </div>

        {/* Team size */}
        <div className="flex w-full flex-col gap-[4px]">
          <FieldRow>
            <FieldLabel htmlFor="field-teamsize">Team size</FieldLabel>
            <select
              id="field-teamsize"
              aria-label="Team size"
              value={form.teamSize}
              onChange={(e) => set('teamSize', e.target.value)}
              aria-describedby={errors.teamSize ? 'err-teamsize' : undefined}
              className={SELECT_CLS}
            >
              <option value="">Select team size…</option>
              {TEAM_SIZES.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
          </FieldRow>
          {errors.teamSize && <FieldError id="err-teamsize" message={errors.teamSize} />}
        </div>

        {/* Region */}
        <div className="flex w-full flex-col gap-[4px]">
          <FieldRow>
            <FieldLabel htmlFor="field-region">Region</FieldLabel>
            <select
              id="field-region"
              aria-label="Region"
              value={form.region}
              onChange={(e) => set('region', e.target.value)}
              aria-describedby={errors.region ? 'err-region' : undefined}
              className={SELECT_CLS}
            >
              <option value="">Select region…</option>
              {REGIONS.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </FieldRow>
          {errors.region && <FieldError id="err-region" message={errors.region} />}
        </div>

        {/* Currency */}
        <div className="flex w-full flex-col gap-[4px]">
          <FieldRow>
            <FieldLabel htmlFor="field-currency">Currency</FieldLabel>
            <select
              id="field-currency"
              aria-label="Currency"
              value={form.currency}
              onChange={(e) => set('currency', e.target.value)}
              aria-describedby={errors.currency ? 'err-currency' : undefined}
              className={SELECT_CLS}
            >
              {CURRENCIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </FieldRow>
          {errors.currency && <FieldError id="err-currency" message={errors.currency} />}
        </div>

        {/* PIC role */}
        <div className="flex w-full flex-col gap-[4px]">
          <FieldRow>
            <FieldLabel htmlFor="field-picrole">Your role</FieldLabel>
            <input
              id="field-picrole"
              type="text"
              aria-label="Your role"
              placeholder="e.g. Ops Lead, Founder, CTO…"
              value={form.picRole}
              onChange={(e) => set('picRole', e.target.value)}
              aria-describedby={errors.picRole ? 'err-picrole' : undefined}
              className={INPUT_CLS}
            />
          </FieldRow>
          {errors.picRole && <FieldError id="err-picrole" message={errors.picRole} />}
        </div>
      </form>

      <div className="w-full flex-1" />

      {/* Footer actions */}
      <div className="flex w-full items-center">
        <span className="h-px flex-1" />
        <PrimaryButton icon={ArrowRight} onClick={() => void handleSubmit(new Event('submit') as unknown as React.FormEvent)}>
          {saving ? 'Saving…' : 'Continue'}
        </PrimaryButton>
      </div>
    </WizardCard>
  )
}

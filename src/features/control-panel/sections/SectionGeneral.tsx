import { useCallback, useEffect, useRef, useState } from 'react'
import { BookOpen, Globe, Languages } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Box, Field, Group, IconTile, PageHeader, PageShell, PenButton, Row, useSectionSave } from '../ControlPanelShared'
import type { SectionProps } from '../ControlPanel'
import { CompanyLogo } from '../../../ui/ds/CompanyLogo'
import { useSession } from '../../../app/session'
import { useCompanyDetail, useCompanySettings, useHandbook, useUpdateCompanyProfile, useUpdateCompanySettings, useUploadCompanyLogo } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage, fileToDataUrl } from '../format'

const INITIAL_GENERAL = {
  name: '',
  about: '',
  timezone: 'Asia/Jakarta',
  language: 'Bahasa Indonesia',
  hours: '08:00 – 21:00',
}

/** IANA zones offered in the picker (the company column stores the IANA id). */
const TIMEZONE_IDS = [
  'Asia/Jakarta', 'Asia/Makassar', 'Asia/Jayapura', 'Asia/Singapore', 'Asia/Kuala_Lumpur', 'Asia/Bangkok',
  'Asia/Ho_Chi_Minh', 'Asia/Manila', 'Australia/Sydney', 'Europe/London', 'America/New_York', 'UTC',
]
const LANGUAGES = ['Bahasa Indonesia', 'English', 'Bahasa Melayu', 'Tiếng Việt', 'ไทย', '中文']

function utcOffset(tz: string): string {
  try {
    const part = new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'shortOffset' })
      .formatToParts(new Date())
      .find((p) => p.type === 'timeZoneName')?.value
    return part ? part.replace('GMT', 'UTC') : 'UTC'
  } catch {
    return 'UTC'
  }
}
const tzLabel = (tz: string) => `${tz} (${utcOffset(tz)})`
const tzFromLabel = (label: string) => label.replace(/\s*\(UTC.*\)$/, '')

function localTime(tz: string): string | null {
  try {
    return new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(new Date())
  } catch {
    return null
  }
}

/** pen xVE7r · Control panel · General */
export function SectionGeneral({ onDialog }: SectionProps) {
  const navigate = useNavigate()
  const sessionCompany = useSession((s) => s.company)
  const sessionCompanyName = sessionCompany?.name ?? ''
  const updateProfile = useUpdateCompanyProfile()
  const { data: handbook } = useHandbook()
  const { data: settings } = useCompanySettings()
  const { data: detail } = useCompanyDetail()
  const updateSettings = useUpdateCompanySettings()
  const uploadLogo = useUploadCompanyLogo()
  const logoInput = useRef<HTMLInputElement>(null)
  const logoCompany = {
    id: sessionCompany?.id ?? 'company',
    name: detail?.name ?? sessionCompanyName,
    initial: (detail?.name ?? sessionCompanyName)[0]?.toUpperCase() ?? '?',
    color: '#EB6834',
    image: detail?.logoUrl ?? null,
  }

  async function handleLogo(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      await uploadLogo.mutateAsync(await fileToDataUrl(file))
      notify('Logo updated')
    } catch (err) {
      notify(errorMessage(err, 'Could not upload the logo'))
    }
  }

  const baseline = useCallback(
    () => ({
      ...INITIAL_GENERAL,
      name: detail?.name ?? sessionCompanyName,
      timezone: detail?.timezone ?? INITIAL_GENERAL.timezone,
      about: typeof settings?.about === 'string' ? settings.about : INITIAL_GENERAL.about,
      language: typeof settings?.language === 'string' ? settings.language : INITIAL_GENERAL.language,
      hours:
        settings?.hours && typeof (settings.hours as { label?: unknown }).label === 'string'
          ? ((settings.hours as { label: string }).label)
          : INITIAL_GENERAL.hours,
    }),
    [sessionCompanyName, settings, detail],
  )

  const [general, setGeneral] = useState(baseline)

  async function persist() {
    // Company name + timezone live on the company profile (PATCH /v1/company).
    await updateProfile.mutateAsync({ name: general.name, timezone: general.timezone })
    // about / language / hours live in free-form company settings.
    await updateSettings.mutateAsync({
      about: general.about,
      language: general.language,
      hours: { label: general.hours },
    })
    notify('General settings saved')
  }

  const { dirty, saving, error, saved, markDirty, save, discard } = useSectionSave(persist, () => setGeneral(baseline()))

  // Reload the editable fields whenever the persisted settings arrive/change,
  // as long as the user hasn't started editing.
  useEffect(() => {
    if (!dirty) setGeneral(baseline())
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline])

  const edit = (key: keyof typeof INITIAL_GENERAL) => (v: string) => {
    setGeneral((prev) => ({ ...prev, [key]: v }))
    markDirty()
  }

  return (
    <PageShell crumb="General" saveBar dirty={dirty} saving={saving} error={error} saved={saved} onSave={save} onDiscard={discard}>
      <PageHeader title="General" sub="Your company’s name, language and hours. Every agent is told these." />

      <Group title="Company">
        <Box>
          <Row title="Logo" desc="Shown in the rail and on anything agents send.">
            <CompanyLogo company={logoCompany} size={36} radius={10} fontSize={15} className="font-bold" />
            <input ref={logoInput} type="file" accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml" className="hidden" aria-label="Upload logo" onChange={(e) => void handleLogo(e)} />
            <PenButton disabled={uploadLogo.isPending} onClick={() => logoInput.current?.click()}>
              {uploadLogo.isPending ? 'Uploading…' : detail?.logoUrl ? 'Change' : 'Upload'}
            </PenButton>
          </Row>
          <Row title="Company name" desc="Told to every agent and used in messages.">
            <Field width={240} value={general.name} onChange={edit('name')} />
          </Row>
          <Row title="What you do" desc="One line agents use to explain the company." last>
            <Field width={300} value={general.about} placeholder="e.g. SaaS for RT/RW neighborhoods" onChange={edit('about')} />
          </Row>
        </Box>
      </Group>

      <div className="flex w-full items-center gap-[14px] rounded-lg bg-soft px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong">
        <IconTile icon={BookOpen} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-ink">Company handbook</span>
          <span className="text-[12.5px] text-muted">
            The brief, policies, services and FAQ — read by every helper, pinned in Docs for your staff.
            {handbook ? ` ${handbook.files.length} files · ${handbook.openSuggestions} suggested edit${handbook.openSuggestions === 1 ? '' : 's'}.` : ''}
          </span>
        </div>
        <PenButton h={30} fs={13} onClick={() => navigate({ to: '/control-panel/$section', params: { section: 'handbook' } })}>Open handbook</PenButton>
      </div>

      <Group title="Language & hours" desc="Agents only message people and run deploys inside work hours.">
        <Box>
          <Row
            title="Time zone"
            desc={`Schedules and the weekly retro run in this zone.${localTime(general.timezone) ? ` It’s ${localTime(general.timezone)} there now.` : ''}`}
          >
            <Field
              width={240}
              icon={Globe}
              value={tzLabel(general.timezone)}
              onChange={(v) => edit('timezone')(tzFromLabel(v))}
              select
              options={(TIMEZONE_IDS.includes(general.timezone) ? TIMEZONE_IDS : [general.timezone, ...TIMEZONE_IDS]).map(tzLabel)}
            />
          </Row>
          <Row title="Agent language" desc="Agents reply in this language unless you write in another.">
            <Field width={240} icon={Languages} value={general.language} onChange={edit('language')} select options={LANGUAGES} />
          </Row>
          <Row title="Work hours" desc="Quiet hours outside these — only P0 alerts get through." last>
            <Field width={240} value={general.hours} onChange={edit('hours')} />
          </Row>
        </Box>
      </Group>

      <Group title="Danger zone">
        <div className="flex w-full items-center gap-[16px] rounded-lg p-[14px] outline-1 -outline-offset-1 outline-[#FECACA]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <span className="text-[13.5px] font-medium text-ink">Delete {sessionCompanyName || 'this workspace'}</span>
            <span className="text-[12px] text-muted">Removes chats, docs, flows and agents for everyone. Export your data first.</span>
          </div>
          <PenButton variant="danger" onClick={() => onDialog('delete-workspace')}>Delete</PenButton>
        </div>
      </Group>
    </PageShell>
  )
}

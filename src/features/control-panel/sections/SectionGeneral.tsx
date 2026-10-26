import { useState } from 'react'
import { BookOpen, Globe, Languages } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Box, Field, Group, IconTile, PageHeader, PageShell, PenButton, Row, useDirtyState } from '../ControlPanelShared'
import type { SectionProps } from '../ControlPanel'
import { useUIStore } from '../../../app/store'
import { COMPANIES } from '../../../app/companies'
import { useAppearance } from '../../../app/appearance'
import { CompanyLogo } from '../../../ui/ds/CompanyLogo'
import { useCompanyLook } from '../../../ui/ds/looks'
import { LookPicker } from '../../../ui/ds/LookPicker'

const INITIAL_GENERAL = {
  name: 'Sahabat Warga',
  about: 'SaaS for RT/RW neighborhoods',
  timezone: 'Asia/Jakarta (UTC+7)',
  language: 'Bahasa Indonesia',
  hours: '08:00 – 21:00',
}

const TIMEZONES = ['Asia/Jakarta (UTC+7)', 'Asia/Singapore (UTC+8)', 'Asia/Kuala_Lumpur (UTC+8)', 'Australia/Sydney (UTC+11)', 'Europe/London (UTC+0)', 'America/New_York (UTC-5)']
const LANGUAGES = ['Bahasa Indonesia', 'English', 'Bahasa Melayu', 'Tiếng Việt', 'ไทย', '中文']

/** pen xVE7r · Control panel · General */
export function SectionGeneral({ onDialog }: SectionProps) {
  const navigate = useNavigate()
  const companyId = useUIStore((st) => st.companyId)
  const company = COMPANIES.find((c) => c.id === companyId) ?? COMPANIES[0]
  const look = useCompanyLook(company)
  const { setLook, resetLook } = useAppearance()

  const [general, setGeneral] = useState(INITIAL_GENERAL)
  const { dirty, markDirty, save, discard } = useDirtyState(() => setGeneral(INITIAL_GENERAL))
  const edit = (key: keyof typeof INITIAL_GENERAL) => (v: string) => {
    setGeneral((prev) => ({ ...prev, [key]: v }))
    markDirty()
  }

  return (
    <PageShell crumb="General" saveBar dirty={dirty} onSave={save} onDiscard={discard}>
      <PageHeader title="General" sub="Your company’s name, language and hours. Every agent is told these." />

      <Group title="Company">
        <Box>
          <Row title="Logo" desc="Shown in the rail and on anything agents send.">
            <CompanyLogo company={company} size={36} radius={10} fontSize={15} className="font-bold" />
            <LookPicker
              kind="company"
              side="bottom"
              title={`${company.name} logo`}
              value={{ color: look.color, initial: look.initial, image: look.image }}
              onChange={(patch) => setLook('companies', company.id, patch)}
              onReset={() => resetLook('companies', company.id)}
            >
              <PenButton>{look.image ? 'Change' : 'Upload'}</PenButton>
            </LookPicker>
          </Row>
          <Row title="Company name" desc="Told to every agent and used in messages.">
            <Field width={240} value={general.name} onChange={edit('name')} />
          </Row>
          <Row title="What you do" desc="One line agents use to explain the company." last>
            <Field width={300} value={general.about} onChange={edit('about')} />
          </Row>
        </Box>
      </Group>

      <div className="flex w-full items-center gap-[14px] rounded-lg bg-soft px-[16px] py-[14px] outline-1 -outline-offset-1 outline-line-strong">
        <IconTile icon={BookOpen} />
        <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
          <span className="text-[13px] font-semibold text-ink">Company handbook</span>
          <span className="text-[12.5px] text-muted">
            The brief, policies, services and FAQ — read by every helper, pinned in Docs for your staff. 6 files · 1 suggested edit.
          </span>
        </div>
        <PenButton h={30} fs={13} onClick={() => navigate({ to: '/control-panel/$section', params: { section: 'handbook' } })}>Open handbook</PenButton>
      </div>

      <Group title="Language & hours" desc="Agents only message people and run deploys inside work hours.">
        <Box>
          <Row title="Time zone" desc="Schedules and the weekly retro run in this zone. It’s 12:38 there now.">
            <Field width={240} icon={Globe} value={general.timezone} onChange={edit('timezone')} select options={TIMEZONES} />
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
            <span className="text-[13.5px] font-medium text-ink">Delete Sahabat Warga</span>
            <span className="text-[12px] text-muted">Removes chats, docs, flows and agents for everyone. Export your data first.</span>
          </div>
          <PenButton variant="danger" onClick={() => onDialog('delete-workspace')}>Delete</PenButton>
        </div>
      </Group>
    </PageShell>
  )
}

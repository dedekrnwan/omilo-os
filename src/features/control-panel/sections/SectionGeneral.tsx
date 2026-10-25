import { BookOpen, Globe, Languages } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Box, Field, Group, IconTile, PageHeader, PageShell, PenButton, Row, useDirtyState } from '../ControlPanelShared'
import type { SectionProps } from '../ControlPanel'

/** pen xVE7r · Control panel · General */
export function SectionGeneral({ onDialog }: SectionProps) {
  const navigate = useNavigate()
  const { dirty, save, discard } = useDirtyState()
  return (
    <PageShell crumb="General" saveBar dirty={dirty} onSave={save} onDiscard={discard}>
      <PageHeader title="General" sub="Your company’s name, language and hours. Every agent is told these." />

      <Group title="Company">
        <Box>
          <Row title="Logo" desc="Shown in the rail and on anything agents send.">
            <span className="flex size-[36px] shrink-0 items-center justify-center rounded-md bg-[#EB6834] text-[15px] font-bold text-white">
              S
            </span>
            <PenButton>Upload</PenButton>
          </Row>
          <Row title="Company name" desc="Told to every agent and used in messages.">
            <Field width={240} value="Sahabat Warga" />
          </Row>
          <Row title="What you do" desc="One line agents use to explain the company." last>
            <Field width={300} value="SaaS for RT/RW neighborhoods" />
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
            <Field width={240} icon={Globe} value="Asia/Jakarta (UTC+7)" select />
          </Row>
          <Row title="Agent language" desc="Agents reply in this language unless you write in another.">
            <Field width={240} icon={Languages} value="Bahasa Indonesia" select />
          </Row>
          <Row title="Work hours" desc="Quiet hours outside these — only P0 alerts get through." last>
            <Field width={240} value="08:00 – 21:00" />
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

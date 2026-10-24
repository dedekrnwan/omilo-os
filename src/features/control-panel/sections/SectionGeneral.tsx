import { BookOpen } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionHeading,
  SectionPane,
  SelectField,
  SettingCard,
  SettingCardRows,
  SettingRow,
  SubHeading,
  TextInput,
} from '../ControlPanelShared'
import type { DialogKind } from '../types'

interface Props {
  onDialog: (d: DialogKind) => void
}

export function SectionGeneral({ onDialog }: Props) {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Topbar breadcrumb */}
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="General" />
      </div>

      <SectionPane>
        <SectionHeading
          title="General"
          subtitle="Your company's name, language and hours. Every agent is told these."
        />

        {/* Company */}
        <SubHeading label="Company" />
        <SettingCardRows>
          {/* Logo */}
          <SettingRow label="Logo" desc="Shown in the rail and on anything agents send.">
            <div className="flex items-center gap-[10px]">
              <span className="flex size-[32px] items-center justify-center rounded-base bg-[#EB6834] text-[14px] font-semibold text-white">
                S
              </span>
              <Button variant="secondary" height={28}>Upload</Button>
            </div>
          </SettingRow>
          <RowDivider />
          <SettingRow label="Company name" desc="Told to every agent and used in messages.">
            <TextInput value="Sahabat Warga" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="What you do" desc="One line agents use to explain the company.">
            <TextInput value="SaaS for RT/RW neighborhoods" />
          </SettingRow>
        </SettingCardRows>

        {/* Handbook callout */}
        <div className="mt-[16px] flex items-center gap-[14px] rounded-lg border border-line-strong bg-soft px-[16px] py-[12px]">
          <BookOpen size={18} className="shrink-0 text-muted" aria-hidden />
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <span className="text-[13px] font-semibold text-ink">Company handbook</span>
            <span className="text-[12px] text-muted">
              The brief, policies, services and FAQ — read by every helper, pinned in Docs for your staff. 6 files · 1 suggested edit.
            </span>
          </div>
          <Button variant="secondary" height={28} onClick={() => onDialog(null)}>
            Open handbook
          </Button>
        </div>

        <Rule />

        {/* Language & hours */}
        <SubHeading label="Language & hours" />
        <p className="mb-[12px] text-[12px] text-muted">Agents only message people and run deploys inside work hours.</p>
        <SettingCardRows>
          <SettingRow label="Time zone" desc="Schedules and the weekly retro run in this zone. It's 12:38 there now.">
            <SelectField value="Asia/Jakarta (UTC+7)" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Agent language" desc="Agents reply in this language unless you write in another.">
            <SelectField value="Bahasa Indonesia" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Work hours" desc="Quiet hours outside these — only P0 alerts get through.">
            <TextInput value="08:00 – 21:00" className="min-w-[140px]" />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Danger zone */}
        <SubHeading label="Danger zone" />
        <SettingCard>
          <div className="flex items-center gap-[16px] px-[16px] py-[14px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-medium text-ink">Delete Sahabat Warga</span>
              <span className="text-[12px] text-muted">Removes chats, docs, flows and agents for everyone. Export your data first.</span>
            </div>
            <button
              type="button"
              onClick={() => onDialog('delete-workspace')}
              className="text-[13px] font-medium text-bad hover:underline"
            >
              Delete
            </button>
          </div>
        </SettingCard>
      </SectionPane>

      <SaveBar />
    </div>
  )
}

import { ExternalLink } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionPane,
  SelectField,
  SettingCard,
  SettingCardRows,
  SettingRow,
  SubHeading,
  Toggle,
} from '../ControlPanelShared'
import { Mascot } from '../../../ui/ds/Mascot'

const AGENTS: Array<{ area: 'ops' | 'dev' | 'marketing' | 'finance' | 'support' | 'sales'; active: boolean }> = [
  { area: 'ops', active: true },
  { area: 'dev', active: true },
  { area: 'marketing', active: true },
  { area: 'finance', active: true },
  { area: 'support', active: true },
  { area: 'sales', active: false },
]

export function SectionKnowledge() {
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Knowledge" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={ExternalLink}>Open in Docs</Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Knowledge</h1>
        <p className="mb-[24px] text-[13px] text-muted">Agent memory, searched by meaning with pgvector. Kept separate from Docs.</p>

        {/* Knowledge on card */}
        <SettingCard>
          <div className="flex items-center gap-[16px] px-[16px] py-[14px]">
            <div className="flex size-[36px] shrink-0 items-center justify-center rounded-base bg-ok-tint">
              <span className="text-[18px]">🧠</span>
            </div>
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <div className="flex items-center gap-[8px]">
                <span className="text-[13px] font-semibold text-ink">Knowledge is on</span>
                <span className="rounded-pill bg-ok-tint px-[8px] py-[1px] text-[11px] font-medium text-ok">On</span>
              </div>
              <span className="text-[12px] text-muted">pgvector 0.7 on db-main · 51 memories · 1,284 vectors · 38 MB</span>
            </div>
            <Toggle on />
          </div>
        </SettingCard>

        <Rule />

        {/* How agents learn */}
        <SubHeading label="How agents learn" />
        <SettingCardRows>
          <SettingRow label="Review before agents use a lesson" desc="New lessons wait in the review list until someone confirms them.">
            <Toggle on />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Who can teach and confirm" desc="Others can suggest; these people decide.">
            <SelectField value="Owners & admins" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Agents that use Knowledge" desc="Turned-off agents work from docs and chat only.">
            <div className="flex items-center gap-[-4px]">
              {AGENTS.map((a, i) => (
                <span
                  key={a.area}
                  style={{ marginLeft: i === 0 ? 0 : -6, zIndex: AGENTS.length - i, opacity: a.active ? 1 : 0.3 }}
                  className="inline-flex"
                >
                  <Mascot size={22} radius={0} area={a.area} tile={false} />
                </span>
              ))}
              <span className="ml-[8px] text-[12px] text-muted">5 of 6</span>
            </div>
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Storage & model */}
        <SubHeading label="Storage & model" />
        <SettingCardRows>
          <SettingRow label="Embedding model" desc="Re-indexes all memories if you change it (~2 min).">
            <SelectField value="Voyage 3 · 1024 dims" />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Keep forgotten memories" desc="So you can undo a Forget.">
            <SelectField value="30 days" />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Turn off */}
        <SubHeading label="Turn off" />
        <SettingCard>
          <div className="flex items-center gap-[16px] px-[16px] py-[14px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-medium text-ink">Turn off Knowledge</span>
              <span className="text-[12px] text-muted">Agents stop using memory now. Memories are deleted after 30 days.</span>
            </div>
            <button type="button" className="rounded-btn border border-bad-line bg-bad-tint px-[10px] py-[5px] text-[12.5px] font-medium text-bad hover:bg-bad hover:text-white transition-colors">
              Turn off
            </button>
          </div>
        </SettingCard>
      </SectionPane>

      <SaveBar />
    </div>
  )
}

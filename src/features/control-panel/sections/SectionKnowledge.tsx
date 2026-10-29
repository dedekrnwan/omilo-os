import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
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
} from '../legacyShared'
import { useSectionSave } from '../ControlPanelShared'
import { Mascot } from '../../../ui/ds/Mascot'
import { notify } from '../../../ui/ds/Toaster'
import { useCompanySettings, useHelpers, useKnowledgeSources, useStorage, useUpdateCompanySettings } from '../../../app/queries'
import type { HelperArea } from '../../../core/domain/types'
import { formatBytes } from '../format'

const WHO_CAN_CONFIRM = ['Owners & admins', 'Owners only', 'Everyone']
const EMBEDDING_MODELS = ['Voyage 3 · 1024 dims', 'OpenAI text-embedding-3-small · 1536 dims', 'Local · bge-m3 · 1024 dims']
const KEEP_FORGOTTEN = ['7 days', '30 days', '90 days', 'Forever']

const INITIAL = {
  knowledgeOn: true,
  reviewBeforeUse: true,
  whoCanConfirm: 'Owners & admins',
  embeddingModel: 'Voyage 3 · 1024 dims',
  keepForgotten: '30 days',
}

export function SectionKnowledge() {
  const navigate = useNavigate()
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()
  const { data: helpers = [] } = useHelpers()
  const { data: sources } = useKnowledgeSources()
  const { data: storage } = useStorage()

  const [knowledgeOn, setKnowledgeOn] = useState(INITIAL.knowledgeOn)
  const [reviewBeforeUse, setReviewBeforeUse] = useState(INITIAL.reviewBeforeUse)
  const [whoCanConfirm, setWhoCanConfirm] = useState(INITIAL.whoCanConfirm)
  const [embeddingModel, setEmbeddingModel] = useState(INITIAL.embeddingModel)
  const [keepForgotten, setKeepForgotten] = useState(INITIAL.keepForgotten)
  const [disabledHelpers, setDisabledHelpers] = useState<string[]>([])

  async function persist() {
    await updateSettings.mutateAsync({
      knowledge: {
        knowledgeOn,
        reviewBeforeUse,
        whoCanConfirm,
        embeddingModel,
        keepForgotten,
        // Read by the runner: these helpers work without Knowledge.
        disabledHelperIds: disabledHelpers,
      },
    })
    notify('Knowledge settings saved')
  }

  function reset() {
    setKnowledgeOn(INITIAL.knowledgeOn)
    setReviewBeforeUse(INITIAL.reviewBeforeUse)
    setWhoCanConfirm(INITIAL.whoCanConfirm)
    setEmbeddingModel(INITIAL.embeddingModel)
    setKeepForgotten(INITIAL.keepForgotten)
    setDisabledHelpers([])
  }

  const { dirty, saving, error, saved, markDirty: mark, save: handleSave, discard: handleDiscard } = useSectionSave(persist, reset)

  // Hydrate from persisted settings when they arrive (unless the user is editing).
  useEffect(() => {
    if (dirty) return
    const k = settings?.knowledge as Record<string, unknown> | undefined
    if (!k) return
    if (typeof k.knowledgeOn === 'boolean') setKnowledgeOn(k.knowledgeOn)
    if (typeof k.reviewBeforeUse === 'boolean') setReviewBeforeUse(k.reviewBeforeUse)
    if (typeof k.whoCanConfirm === 'string') setWhoCanConfirm(k.whoCanConfirm)
    if (typeof k.embeddingModel === 'string') setEmbeddingModel(k.embeddingModel)
    if (typeof k.keepForgotten === 'string') setKeepForgotten(k.keepForgotten)
    if (Array.isArray(k.disabledHelperIds)) setDisabledHelpers(k.disabledHelperIds.filter((x): x is string => typeof x === 'string'))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  async function handleTurnOff() {
    setKnowledgeOn(false)
    try {
      await updateSettings.mutateAsync({ knowledge: { knowledgeOn: false } })
      notify('Knowledge turned off — agents stop using memory now')
    } catch (e) {
      setKnowledgeOn(true)
      notify(e instanceof Error && e.message ? e.message : 'Could not turn Knowledge off')
    }
  }

  function toggleHelper(id: string) {
    setDisabledHelpers((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))
    mark()
  }

  const knowledgeBytes = storage?.segments.find((seg) => seg.key === 'knowledge')?.bytes
  const memoryCount = sources?.length ?? 0
  const activeHelpers = helpers.filter((h) => !disabledHelpers.includes(h.id)).length

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Knowledge" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={ExternalLink} onClick={() => void navigate({ to: '/docs' })}>Open in Docs</Button>
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
                <span className="text-[13px] font-semibold text-ink">{knowledgeOn ? 'Knowledge is on' : 'Knowledge is off'}</span>
                <span className={`rounded-pill px-[8px] py-[1px] text-[11px] font-medium ${knowledgeOn ? 'bg-ok-tint text-ok' : 'bg-soft text-muted'}`}>{knowledgeOn ? 'On' : 'Off'}</span>
              </div>
              <span className="text-[12px] text-muted">
                pgvector · {memoryCount} source{memoryCount === 1 ? '' : 's'} indexed{knowledgeBytes != null ? ` · ${formatBytes(knowledgeBytes)}` : ''}
              </span>
            </div>
            <Toggle on={knowledgeOn} onClick={() => { setKnowledgeOn((v) => !v); mark() }} />
          </div>
        </SettingCard>

        <Rule />

        {/* How agents learn */}
        <SubHeading label="How agents learn" />
        <SettingCardRows>
          <SettingRow label="Review before agents use a lesson" desc="New lessons wait in the review list until someone confirms them.">
            <Toggle on={reviewBeforeUse} onClick={() => { setReviewBeforeUse((v) => !v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Who can teach and confirm" desc="Others can suggest; these people decide.">
            <SelectField aria-label="Who can teach and confirm" value={whoCanConfirm} options={WHO_CAN_CONFIRM} onChange={(v) => { setWhoCanConfirm(v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Agents that use Knowledge" desc="Turned-off agents work from docs and chat only.">
            <div className="flex items-center gap-[-4px]">
              {helpers.map((h, i) => {
                const on = !disabledHelpers.includes(h.id)
                return (
                  <button
                    key={h.id}
                    type="button"
                    aria-pressed={on}
                    aria-label={`${h.name} uses Knowledge`}
                    title={`${h.name} — ${on ? 'uses Knowledge' : 'off'} (click to toggle)`}
                    onClick={() => toggleHelper(h.id)}
                    style={{ marginLeft: i === 0 ? 0 : -6, zIndex: helpers.length - i, opacity: on ? 1 : 0.3 }}
                    className="inline-flex"
                  >
                    <Mascot helper size={22} radius={0} area={h.area as HelperArea} tile={false} />
                  </button>
                )
              })}
              <span className="ml-[8px] text-[12px] text-muted">{activeHelpers} of {helpers.length}</span>
            </div>
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Storage & model */}
        <SubHeading label="Storage & model" />
        <SettingCardRows>
          <SettingRow label="Embedding model" desc="Re-indexes all memories if you change it (~2 min).">
            <SelectField aria-label="Embedding model" value={embeddingModel} options={EMBEDDING_MODELS} onChange={(v) => { setEmbeddingModel(v); mark() }} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Keep forgotten memories" desc="So you can undo a Forget.">
            <SelectField aria-label="Keep forgotten memories" value={keepForgotten} options={KEEP_FORGOTTEN} onChange={(v) => { setKeepForgotten(v); mark() }} />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Turn off */}
        <SubHeading label="Turn off" />
        <SettingCard>
          <div className="flex items-center gap-[16px] px-[16px] py-[14px]">
            <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
              <span className="text-[13px] font-medium text-ink">Turn off Knowledge</span>
              <span className="text-[12px] text-muted">Agents stop using memory now. Memories are kept so you can turn it back on.</span>
            </div>
            <button type="button" disabled={!knowledgeOn} onClick={() => void handleTurnOff()} className="rounded-btn border border-bad-line bg-bad-tint px-[10px] py-[5px] text-[12.5px] font-medium text-bad hover:bg-bad hover:text-white transition-colors">
              Turn off
            </button>
          </div>
        </SettingCard>
      </SectionPane>

      <SaveBar dirty={dirty} saving={saving} error={error} saved={saved} onSave={handleSave} onDiscard={handleDiscard} />
    </div>
  )
}

import { useEffect, useState } from 'react'
import { Download } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import {
  Breadcrumb,
  RowDivider,
  Rule,
  SaveBar,
  SectionPane,
  SelectField,
  SettingCardRows,
  SettingRow,
  SubHeading,
} from '../legacyShared'
import { useSectionSave } from '../ControlPanelShared'
import { useCommands } from '../../../app/CommandsProvider'
import {
  useCompanySettings,
  useCreateDataExport,
  useDataExports,
  useStorage,
  useUpdateCompanySettings,
} from '../../../app/queries'
import type { DataExport } from '../../../core/domain/controlPanel'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage, formatBytes, saveBlob, shortDate } from '../format'
import { EmptyState } from '../../../ui/ds/EmptyState'

const SEGMENT_COLORS: Record<string, string> = {
  chats: '#6366F1',
  docs: '#0EA5E9',
  run_logs: '#F97316',
  knowledge: '#14B8A6',
  exports: '#A855F7',
  other: '#A8A29E',
}

const CHAT_KEEP = ['Forever', '1 year', '90 days']
const RUN_LOG_KEEP = ['30 days', '90 days', '1 year', 'Forever']
const ACTIVITY_KEEP = ['90 days', '1 year', '2 years', 'Forever']

const INITIAL = { chats: 'Forever', runLogs: '90 days', activity: '1 year' }

function exportSummary(e: DataExport): string {
  const counts = e.summary ?? {}
  const parts = [
    counts.session ? `${counts.session} chats` : null,
    counts.memory_doc ? `${counts.memory_doc} docs` : null,
    counts.flow ? `${counts.flow} flows` : null,
  ].filter(Boolean)
  const days = e.expiresAt ? Math.max(0, Math.ceil((new Date(e.expiresAt).getTime() - Date.now()) / 86_400_000)) : null
  return [
    parts.length ? parts.join(', ') : 'Chats, docs, flows, knowledge',
    `${formatBytes(e.sizeBytes)} zip`,
    days != null ? `link expires in ${days} day${days === 1 ? '' : 's'}` : null,
  ].filter(Boolean).join(' · ')
}

export function SectionData() {
  const commands = useCommands()
  const { data: storage, isLoading: storageLoading } = useStorage()
  const { data: exports = [], isLoading: exportsLoading } = useDataExports()
  const { data: settings } = useCompanySettings()
  const updateSettings = useUpdateCompanySettings()
  const createExport = useCreateDataExport()
  const [downloading, setDownloading] = useState<string | null>(null)
  const [keep, setKeep] = useState(INITIAL)

  async function persist() {
    await updateSettings.mutateAsync({ data: { retention: keep } })
    notify('Retention saved')
  }
  const { dirty, saving, error, saved, markDirty, save, discard } = useSectionSave(persist, () => setKeep(INITIAL))

  useEffect(() => {
    if (dirty) return
    const r = (settings?.data as { retention?: Partial<typeof INITIAL> } | undefined)?.retention
    if (r) setKeep((prev) => ({ ...prev, ...r }))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings])

  const setKeepField = (k: keyof typeof INITIAL) => (v: string) => {
    setKeep((prev) => ({ ...prev, [k]: v }))
    markDirty()
  }

  async function handleExport() {
    try {
      const e = await createExport.mutateAsync()
      notify(e.status === 'ready' ? 'Export ready — download it below' : (e.error ?? 'Export failed'))
    } catch (err) {
      notify(errorMessage(err, 'Could not start the export'))
    }
  }

  async function handleDownload(e: DataExport) {
    setDownloading(e.id)
    try {
      saveBlob(await commands.downloadDataExport(e.id), e.filename || 'omilo-export.zip')
    } catch (err) {
      notify(errorMessage(err, 'Could not download the export'))
    } finally {
      setDownloading(null)
    }
  }

  const used = storage?.usedBytes ?? 0
  const quota = storage?.quotaBytes ?? null
  const scale = quota ?? Math.max(used, 1)
  const segments = (storage?.segments ?? []).filter((s) => s.bytes > 0)

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex h-[44px] shrink-0 items-center border-b border-line px-[24px]">
        <Breadcrumb section="Data & storage" />
        <div className="ml-auto">
          <Button variant="secondary" height={28} icon={Download} disabled={createExport.isPending} onClick={() => void handleExport()}>
            {createExport.isPending ? 'Exporting…' : 'Export everything'}
          </Button>
        </div>
      </div>

      <SectionPane>
        <h1 className="mb-[4px] font-display text-[28px] font-semibold text-ink">Data & storage</h1>
        <p className="mb-[24px] text-[13px] text-muted">What Omilo keeps, for how long, and how to take it with you.</p>

        {/* Storage bar */}
        <div className="mb-[24px] rounded-lg border border-line-strong bg-surface p-[16px]">
          {storageLoading ? (
            <p className="text-[13px] text-muted">Measuring storage…</p>
          ) : (
            <>
              <p className="mb-[4px] text-[28px] font-semibold text-ink">
                {formatBytes(used)}{' '}
                <span className="text-[16px] font-normal text-muted">{quota != null ? `of ${formatBytes(quota)}` : 'used · no limit'}</span>
              </p>
              {/* Segmented bar */}
              <div className="mb-[8px] h-[8px] overflow-hidden rounded-full bg-line-strong">
                <div className="flex h-full">
                  {segments.map((s) => (
                    <div
                      key={s.key}
                      className="h-full"
                      style={{ width: `${Math.max(0.5, (s.bytes / scale) * 100)}%`, background: SEGMENT_COLORS[s.key] ?? '#A8A29E' }}
                    />
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap gap-[12px]">
                {(storage?.segments ?? []).map((s) => (
                  <span key={s.key} className="flex items-center gap-[4px] text-[11.5px] text-muted">
                    <span className="size-[8px] rounded-full" style={{ background: SEGMENT_COLORS[s.key] ?? '#A8A29E' }} />
                    {s.label} {formatBytes(s.bytes)}
                  </span>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Keep for */}
        <SubHeading label="Keep for" />
        <SettingCardRows>
          <SettingRow label="Chat history" desc="Archived chats are kept the same way.">
            <SelectField aria-label="Keep chat history" value={keep.chats} options={CHAT_KEEP} onChange={setKeepField('chats')} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Flow run logs" desc="Inputs and outputs of every step.">
            <SelectField aria-label="Keep flow run logs" value={keep.runLogs} options={RUN_LOG_KEEP} onChange={setKeepField('runLogs')} />
          </SettingRow>
          <RowDivider />
          <SettingRow label="Activity log" desc="Who did what, for audits.">
            <SelectField aria-label="Keep activity log" value={keep.activity} options={ACTIVITY_KEEP} onChange={setKeepField('activity')} />
          </SettingRow>
        </SettingCardRows>

        <Rule />

        {/* Exports */}
        <SubHeading label="Exports" />
        {exportsLoading && <p className="text-[13px] text-muted">Loading exports…</p>}
        {!exportsLoading && exports.length === 0 && (
          <div className="rounded-lg border border-line-strong bg-surface">
            <EmptyState
              size="sm"
              title="No exports yet"
              description="“Export everything” builds a zip of your company’s data — chats, docs, notes and settings."
              primary={{ label: 'Export everything', icon: Download, onClick: () => void handleExport() }}
            />
          </div>
        )}
        {exports.length > 0 && (
          <div className="overflow-hidden rounded-lg border border-line-strong bg-surface">
            {exports.map((e, i) => (
              <div key={e.id} className={`flex items-center gap-[12px] px-[16px] py-[12px] ${i < exports.length - 1 ? 'border-b border-line' : ''}`}>
                <span className="flex size-[32px] shrink-0 items-center justify-center rounded-base border border-line-strong bg-soft text-[16px]">📦</span>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[13px] font-semibold text-ink">Full export · {shortDate(e.createdAt)}</span>
                  <span className="text-[12px] text-muted">{e.status === 'failed' ? (e.error ?? 'Export failed') : exportSummary(e)}</span>
                </div>
                <Button
                  variant="secondary"
                  height={28}
                  icon={Download}
                  disabled={e.status !== 'ready' || downloading === e.id}
                  onClick={() => void handleDownload(e)}
                >
                  {downloading === e.id ? 'Downloading…' : 'Download'}
                </Button>
              </div>
            ))}
          </div>
        )}
      </SectionPane>

      <SaveBar dirty={dirty} saving={saving} error={error} saved={saved} onSave={save} onDiscard={discard} />
    </div>
  )
}

import { useState } from 'react'
import { ArrowUpRight, Cpu, Info } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { useCompanySettings, useHelpers, useUpdateCompanySettings, useUpdateHelper } from '../../app/queries'
import { MODEL_IDS, companyDefaultModel } from './model'
import { Btn, Drawer, DrawerClose, DrawerTitle, Eyebrow, IconTile, SelectField } from './ui'
import type { SelectOption } from './ui'

const COMPANY_DEFAULT_OPTIONS: readonly SelectOption[] = MODEL_IDS.map((m) => ({ value: m, label: `${m} · Anthropic` }))

/** Roles & models — pen JYwEe (Drawer a3egX). Rows are the live team. */
export function RolesModelsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const updateHelper = useUpdateHelper()
  const updateSettings = useUpdateCompanySettings()
  const { data: team = [], isLoading } = useHelpers()
  const { data: settings } = useCompanySettings()
  const savedDefault = companyDefaultModel(settings)
  const [companyDefaultState, setCompanyDefault] = useState<string | null>(null)
  const companyDefault = companyDefaultState ?? savedDefault
  // '' = follow the company default
  const [edits, setModels] = useState<Record<string, string>>({})
  const modelOf = (id: string, saved: string | null | undefined) => edits[id] ?? saved ?? ''
  const modelOptions: SelectOption[] = [
    { value: '', label: `Default · ${companyDefault}` },
    ...MODEL_IDS.map((m) => ({ value: m, label: m })),
  ]

  const save = () => {
    const changed = team.filter((h) => edits[h.id] !== undefined && edits[h.id] !== (h.model ?? ''))
    const defaultChanged = companyDefault !== savedDefault
    Promise.all([
      ...changed.map((h) => updateHelper.mutateAsync({ id: h.id, input: { model: edits[h.id] } })),
      ...(defaultChanged ? [updateSettings.mutateAsync({ aiEngine: { defaultModel: companyDefault } })] : []),
    ])
      .then(() => {
        notify(changed.length || defaultChanged ? 'Models updated' : 'Nothing to save')
        onClose()
      })
      .catch(() => notify("Couldn't update models"))
  }

  return (
    <Drawer
      label="Roles & models"
      onClose={onClose}
      head={
        <>
          <IconTile icon={Cpu} />
          <DrawerTitle
            title="Roles & models"
            sub="Which model each helper thinks with. Keys and providers live in Control panel → AI accounts."
          />
          <DrawerClose onClose={onClose} />
        </>
      }
      footer={
        <>
          <Btn
            variant="quiet"
            icon={ArrowUpRight}
            onClick={() => {
              onClose()
              void navigate({ to: '/control-panel/$section', params: { section: 'ai-accounts' } })
            }}
          >
            Open AI accounts
          </Btn>
          <span className="h-px flex-1" />
          <Btn onClick={onClose}>Cancel</Btn>
          <Btn variant="primary" onClick={save} disabled={updateHelper.isPending || updateSettings.isPending}>
            {updateHelper.isPending || updateSettings.isPending ? 'Saving…' : 'Save'}
          </Btn>
        </>
      }
    >
      <SelectField
        label="Company default"
        icon={Cpu}
        value={companyDefault}
        options={COMPANY_DEFAULT_OPTIONS}
        onChange={setCompanyDefault}
        fs={14}
        className="w-full"
      />
      <Eyebrow>PER HELPER</Eyebrow>
      <div className="flex w-full flex-col rounded-lg px-[14px] outline-1 -outline-offset-1 outline-line-strong">
        {isLoading && <span className="py-[12px] text-[12.5px] text-muted">Loading helpers…</span>}
        {!isLoading && team.length === 0 && (
          <span className="py-[12px] text-[12.5px] text-muted">No helpers yet.</span>
        )}
        {team.map((h, i) => (
          <div
            key={h.id}
            className={`flex w-full items-center gap-[12px] py-[10px] ${
              i < team.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
            }`}
          >
            <Mascot helper size={28} radius={7} area={h.area} title={h.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[13px] font-medium text-ink">{h.name}</span>
              <span className="truncate text-[12px] text-muted">{h.title || h.role || h.area}</span>
            </div>
            <SelectField
              value={modelOf(h.id, h.model)}
              options={modelOptions}
              onChange={(v) => setModels((prev) => ({ ...prev, [h.id]: v }))}
              width={170}
            />
          </div>
        ))}
      </div>
      <div className="flex w-full items-center gap-[8px]">
        <Info size={13} aria-hidden className="text-muted" />
        <span className="text-[12px] text-muted">
          Sonnet is ~3× cheaper — good for helpers that write a lot of short replies.
        </span>
      </div>
    </Drawer>
  )
}

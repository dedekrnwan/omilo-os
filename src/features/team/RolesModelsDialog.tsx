import { useState } from 'react'
import { ArrowUpRight, Cpu, Info } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../ui/ds/Mascot'
import { notify } from '../../ui/ds/Toaster'
import { useUpdateHelper } from '../../app/queries'
import { HELPER_MODEL_ROWS } from './teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, Eyebrow, IconTile, SelectField } from './ui'
import type { SelectOption } from './ui'

const MODEL_OPTIONS: readonly SelectOption[] = [
  { value: 'Opus 5.5', label: 'Opus 5.5' },
  { value: 'Sonnet 5.5', label: 'Sonnet 5.5' },
  { value: 'Haiku 5.5', label: 'Haiku 5.5' },
]

const COMPANY_DEFAULT_OPTIONS: readonly SelectOption[] = [
  { value: 'Opus 5.5 · Anthropic', label: 'Opus 5.5 · Anthropic' },
  { value: 'Sonnet 5.5 · Anthropic', label: 'Sonnet 5.5 · Anthropic' },
  { value: 'Haiku 5.5 · Anthropic', label: 'Haiku 5.5 · Anthropic' },
]

/** Roles & models — pen JYwEe (Drawer a3egX). */
export function RolesModelsDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const updateHelper = useUpdateHelper()
  const [companyDefault, setCompanyDefault] = useState('Opus 5.5 · Anthropic')
  const [models, setModels] = useState<Record<string, string>>(() =>
    Object.fromEntries(HELPER_MODEL_ROWS.map((r) => [r.helperId, r.model])),
  )

  const save = () => {
    const changed = HELPER_MODEL_ROWS.filter((r) => models[r.helperId] !== r.model)
    Promise.all(
      changed.map((r) => updateHelper.mutateAsync({ id: r.helperId, input: { model: models[r.helperId] } })),
    )
      .then(() => {
        notify(changed.length ? 'Models updated' : 'Nothing to save')
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
          <Btn variant="primary" onClick={save} disabled={updateHelper.isPending}>
            {updateHelper.isPending ? 'Saving…' : 'Save'}
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
        {HELPER_MODEL_ROWS.map((r, i) => (
          <div
            key={r.helperId}
            className={`flex w-full items-center gap-[12px] py-[10px] ${
              i < HELPER_MODEL_ROWS.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
            }`}
          >
            <Mascot helper size={28} radius={7} area={r.area} title={r.name} />
            <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
              <span className="text-[13px] font-medium text-ink">{r.name}</span>
              <span className="text-[12px] text-muted">{r.description}</span>
            </div>
            <SelectField
              value={models[r.helperId]}
              options={MODEL_OPTIONS}
              onChange={(v) => setModels((prev) => ({ ...prev, [r.helperId]: v }))}
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

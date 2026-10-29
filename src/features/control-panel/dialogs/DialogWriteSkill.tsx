import { useEffect, useState } from 'react'
import { Button } from '../../../ui/ds/Button'
import { Modal, SelectField, TextInput } from '../legacyShared'
import { useCreateSkill, useHelpers, usePublishSkill, useSkill, useUpdateSkill } from '../../../app/queries'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage } from '../format'

interface Props {
  onClose: () => void
  /** When set, the dialog opens in edit mode pre-filled with this skill. */
  skill?: { id?: string; name: string; desc: string; helperId?: string; status?: string }
  /** Starter template (name + steps) for a new skill. */
  starter?: { name: string; body: string }
}

const PLACEHOLDER = `# When a resident asks for a guest pass
1. Ask for guest name, date and plate number.
2. Create the pass.
3. Send the QR to the resident on WhatsApp.
# Never
4. Make passes for more than 3 days.`

export function DialogWriteSkill({ onClose, skill, starter }: Props) {
  const editing = !!skill?.id
  const { data: helpers = [] } = useHelpers()
  const createSkill = useCreateSkill()
  const updateSkill = useUpdateSkill()
  const publishSkill = usePublishSkill()
  const [name, setName] = useState(skill?.name ?? starter?.name ?? '')
  const [body, setBody] = useState(skill?.desc ?? starter?.body ?? '')
  const [helperId, setHelperId] = useState(skill?.helperId ?? '')
  // List rows carry no body — load the full skill when editing.
  const { data: full, isLoading: loadingFull } = useSkill(skill?.id ?? '')
  const [touched, setTouched] = useState(false)
  useEffect(() => {
    if (!touched && full?.bodyMd) setBody(full.bodyMd)
  }, [full, touched])
  const helper = helpers.find((h) => h.id === helperId) ?? helpers.find((h) => h.isChief) ?? helpers[0]
  const busy = createSkill.isPending || updateSkill.isPending || publishSkill.isPending
  const valid = !!name.trim() && !!body.trim() && !!helper && !(editing && loadingFull)

  async function save(publish: boolean) {
    if (!helper) return
    try {
      const saved = editing && skill?.id
        ? await updateSkill.mutateAsync({ id: skill.id, input: { name: name.trim(), bodyMd: body, helperId: helper.id } })
        : await createSkill.mutateAsync({ helperId: helper.id, name: name.trim(), bodyMd: body })
      if (publish && saved.status !== 'active') {
        await publishSkill.mutateAsync(saved.id)
        notify(`"${saved.name}" sent for review — approve it in your inbox`)
      } else {
        notify(editing ? 'Skill saved' : 'Draft saved')
      }
      onClose()
    } catch (e) {
      notify(errorMessage(e, 'Could not save the skill'))
    }
  }

  return (
    <Modal
      title={editing ? 'Edit skill' : 'Write a skill'}
      subtitle="A skill is a short playbook any helper can run. Write it in plain words."
      width={560}
      onClose={onClose}
      footer={
        <>
          <div className="flex-1" />
          <Button variant="secondary" height={30} disabled={!valid || busy} onClick={() => void save(false)}>
            {editing ? 'Save' : 'Save draft'}
          </Button>
          {skill?.status !== 'active' && (
            <Button variant="primary" height={30} disabled={!valid || busy} onClick={() => void save(true)}>
              Publish skill
            </Button>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[14px]">
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Name</p>
          <TextInput aria-label="Skill name" value={name} placeholder="Visitor pass" onChange={setName} className="w-full min-w-0" />
        </div>
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Who uses it</p>
          <SelectField
            aria-label="Who uses it"
            value={helper?.name ?? 'No helpers yet'}
            options={helpers.map((h) => h.name)}
            onChange={(v) => setHelperId(helpers.find((h) => h.name === v)?.id ?? '')}
          />
        </div>
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Steps</p>
          <textarea
            aria-label="Steps"
            value={body}
            onChange={(e) => { setBody(e.target.value); setTouched(true) }}
            placeholder={PLACEHOLDER}
            rows={9}
            className="w-full rounded-base border border-line-strong bg-soft p-[10px] font-mono text-[12.5px] text-ink outline-none focus:border-ink"
          />
          <p className="mt-[4px] text-[11.5px] text-muted">Publishing sends it to your inbox for review before helpers use it.</p>
        </div>
      </div>
    </Modal>
  )
}

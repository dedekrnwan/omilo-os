import { Button } from '../../../ui/ds/Button'
import { Modal, SelectField, TextInput } from '../ControlPanelShared'

interface Props {
  onClose: () => void
}

export function DialogWriteSkill({ onClose }: Props) {
  return (
    <Modal
      title="Write a skill"
      subtitle="A skill is a short playbook any helper can run. Write it in plain words."
      width={560}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-[12.5px] text-muted hover:underline">Draft with Chief</button>
          <div className="flex-1" />
          <Button variant="secondary" height={30} onClick={onClose}>Save draft</Button>
          <Button variant="primary" height={30}>Publish skill</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[14px]">
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Name</p>
          <TextInput value="Visitor pass" className="w-full min-w-0" />
        </div>
        <div className="grid grid-cols-2 gap-[10px]">
          <div>
            <p className="mb-[6px] text-[12px] font-medium text-muted">Who can use it</p>
            <SelectField value="Support, Ops" />
          </div>
          <div>
            <p className="mb-[6px] text-[12px] font-medium text-muted">Runs</p>
            <SelectField value="Ask each time" />
          </div>
        </div>
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Steps</p>
          <div className="flex flex-col gap-[4px] rounded-base border border-line-strong bg-soft p-[10px]">
            {[
              '# When a resident asks for a guest pass',
              '1. Ask for guest name, date and plate number.',
              '2. Create a pass in sahabat-db (create_visitor_pass).',
              '3. Send the QR to the resident on WhatsApp.',
              '4. Tell the security post in #security.',
              '# Never',
              '5. Make passes for more than 3 days.',
            ].map((line, i) => (
              <p key={i} className={`font-mono text-[12.5px] ${line.startsWith('#') ? 'text-muted' : 'text-ink'}`}>
                {!line.startsWith('#') ? `${line}` : line}
              </p>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-[6px] text-[12px] font-medium text-muted">Tools it may use</p>
          <div className="flex flex-wrap gap-[6px]">
            {['sahabat-db', 'WhatsApp Business', 'Google Drive'].map((t) => (
              <span key={t} className="flex items-center gap-[4px] rounded-pill border border-line-strong bg-surface px-[8px] py-[3px] text-[12px] text-ink">
                {t}
              </span>
            ))}
          </div>
        </div>
        {/* Dry run result */}
        <div className="flex items-center gap-[8px] rounded-lg border border-ok-line bg-ok-tint px-[12px] py-[8px]">
          <span className="text-ok text-[13px]">✓</span>
          <span className="text-[12.5px] font-medium text-ok">Dry run passed · 4 steps, no messages sent</span>
          <button type="button" className="ml-auto text-[12px] text-link hover:underline">Run again</button>
        </div>
      </div>
    </Modal>
  )
}

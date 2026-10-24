import { Server } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Modal, TextInput, SelectField } from '../ControlPanelShared'

interface Props {
  onClose: () => void
  mode?: 'remote' | 'local' | 'oas'
}

const HOW_ITEMS = [
  { id: 'remote', label: 'Remote (URL)', desc: 'An MCP server you host, reached over HTTPS.' },
  { id: 'local', label: 'Local command', desc: "Runs on Omilo's sandbox from an npm or Docker package." },
  { id: 'oas', label: 'Build from an OAS · with Chief', desc: 'Upload your OpenApi Specification (OAS). Chief turns it into tools and Omilo hosts this server.' },
]

const TOOLS = [
  { name: 'find_resident', desc: 'Look up a resident by unit or phone', level: 'Read' },
  { name: 'create_visitor_pass', desc: 'New guest QR pass', level: 'Asks first' },
  { name: 'log_complaint', desc: 'Save a complaint ticket', level: 'Asks first' },
  { name: 'delete_resident', desc: 'Remove a resident record', level: 'Blocked' },
]

export function DialogAddMcp({ onClose, mode = 'remote' }: Props) {
  return (
    <Modal
      title="Add an MCP server"
      subtitle="Give every helper access to your own tools and data. Pick who can use it per helper in Team."
      width={520}
      onClose={onClose}
      footer={
        <>
          <button type="button" className="text-[12.5px] text-muted hover:underline flex items-center gap-[4px]">
            📄 Docs
          </button>
          <div className="flex-1" />
          <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
          <Button variant="primary" height={30} icon={Server}>Add server</Button>
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        {/* How it connects */}
        <div>
          <p className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">How it connects</p>
          <div className="flex flex-col gap-[6px]">
            {HOW_ITEMS.map((item) => (
              <label key={item.id} className={`flex cursor-pointer items-start gap-[8px] rounded-base border p-[10px] ${mode === item.id ? 'border-ink bg-surface' : 'border-line-strong bg-soft'}`}>
                <span className={`mt-[1px] flex size-[16px] shrink-0 items-center justify-center rounded-full border-2 ${mode === item.id ? 'border-ink bg-ink' : 'border-line-strong bg-surface'}`}>
                  {mode === item.id && <span className="size-[6px] rounded-full bg-white" />}
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-ink">{item.label}</p>
                  <p className="text-[12px] text-muted">{item.desc}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {mode === 'remote' && (
          <>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">Name</p>
              <TextInput value="sahabat-db" className="w-full min-w-0" />
            </div>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">Server URL</p>
              <TextInput value="https://mcp.sahabatwarga.id/sse" className="w-full min-w-0" />
            </div>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">Authentication</p>
              <SelectField value="Bearer token" />
            </div>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">Token</p>
              <TextInput value="xb-1liv-••••••••••••31Yu" className="w-full min-w-0 font-mono" />
              <p className="mt-[4px] text-[11.5px] text-muted">Stored encrypted. Only sent to this server.</p>
            </div>

            {/* Connected tools preview */}
            <div className="rounded-lg border border-ok-line bg-ok-tint px-[12px] py-[10px]">
              <p className="mb-[8px] text-[12.5px] font-semibold text-ok">✓ Connected · found 5 tools</p>
              <div className="flex flex-col gap-[4px]">
                {TOOLS.map((t) => (
                  <div key={t.name} className="flex items-center gap-[8px]">
                    <span className="font-mono text-[11.5px] text-ink">{t.name}</span>
                    <span className="text-[11.5px] text-muted">{t.desc}</span>
                    <span className={`ml-auto rounded-pill px-[6px] py-[1px] text-[10.5px] font-medium ${
                      t.level === 'Read' ? 'bg-info-tint text-info border border-info-line' :
                      t.level === 'Asks first' ? 'bg-warn-tint text-warn border border-warn-line' :
                      'bg-bad-tint text-bad border border-bad-line'
                    }`}>
                      {t.level}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}
      </div>
    </Modal>
  )
}

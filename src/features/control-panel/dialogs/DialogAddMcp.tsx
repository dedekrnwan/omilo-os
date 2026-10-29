import { useState } from 'react'
import { Server } from 'lucide-react'
import { Button } from '../../../ui/ds/Button'
import { Modal, TextInput, SelectField } from '../legacyShared'
import { useCreateMcpServer, useCreateMcpServerFromOpenApi } from '../../../app/queries'
import type { McpServer } from '../../../core/domain/controlPanel'
import { notify } from '../../../ui/ds/Toaster'
import { errorMessage } from '../format'

type Mode = 'remote' | 'local' | 'oas'

interface Props {
  onClose: () => void
  mode?: Mode
}

const HOW_ITEMS: { id: Mode; label: string; desc: string; soon?: boolean }[] = [
  { id: 'remote', label: 'Remote (URL)', desc: 'An MCP server you host, reached over HTTPS.' },
  { id: 'local', label: 'Local command', desc: "Runs on Omilo's sandbox from an npm or Docker package.", soon: true },
  { id: 'oas', label: 'Build from an OAS', desc: 'Upload your OpenAPI Specification (OAS). Omilo turns each operation into a tool helpers can call.' },
]

const AUTH = ['No authentication', 'Bearer token']

const LEVEL_LABEL: Record<string, string> = { read: 'Read', ask: 'Asks first', blocked: 'Blocked' }

function ToolsPreview({ server }: { server: McpServer }) {
  if (server.status === 'error') {
    return (
      <div className="rounded-lg border border-bad-line bg-bad-tint px-[12px] py-[10px]">
        <p className="text-[12.5px] font-semibold text-bad">Saved, but we couldn’t reach it</p>
        <p className="text-[12px] text-ink-2">{server.error}</p>
      </div>
    )
  }
  return (
    <div className="rounded-lg border border-ok-line bg-ok-tint px-[12px] py-[10px]">
      <p className="mb-[8px] text-[12.5px] font-semibold text-ok">
        ✓ Connected · found {server.tools.length} tool{server.tools.length === 1 ? '' : 's'}
      </p>
      <div className="flex max-h-[220px] flex-col gap-[4px] overflow-y-auto">
        {server.tools.map((t) => (
          <div key={t.name} className="flex items-center gap-[8px]">
            <span className="font-mono text-[11.5px] text-ink">{t.name}</span>
            <span className="min-w-0 truncate text-[11.5px] text-muted">{t.description}</span>
            <span className={`ml-auto shrink-0 rounded-pill px-[6px] py-[1px] text-[10.5px] font-medium ${
              t.level === 'read' ? 'bg-info-tint text-info border border-info-line' :
              t.level === 'ask' ? 'bg-warn-tint text-warn border border-warn-line' :
              'bg-bad-tint text-bad border border-bad-line'
            }`}>
              {LEVEL_LABEL[t.level] ?? t.level}
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

export function DialogAddMcp({ onClose, mode: initialMode = 'remote' }: Props) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [auth, setAuth] = useState(AUTH[0])
  const [token, setToken] = useState('')
  const [spec, setSpec] = useState('')
  const [specUrl, setSpecUrl] = useState('')
  const [result, setResult] = useState<McpServer | null>(null)
  const createRemote = useCreateMcpServer()
  const createOas = useCreateMcpServerFromOpenApi()
  const busy = createRemote.isPending || createOas.isPending

  const canSubmit =
    !!name.trim() &&
    (mode === 'remote'
      ? /^https?:\/\//.test(url.trim()) && (auth === AUTH[0] || !!token.trim())
      : mode === 'oas'
        ? !!spec.trim() || /^https?:\/\//.test(specUrl.trim())
        : false)

  async function submit() {
    try {
      const server =
        mode === 'remote'
          ? await createRemote.mutateAsync({ name: name.trim(), url: url.trim(), token: auth === AUTH[1] ? token.trim() : undefined })
          : await createOas.mutateAsync({
              name: name.trim(),
              ...(spec.trim() ? { spec: spec.trim() } : { specUrl: specUrl.trim() }),
            })
      setResult(server)
      notify(server.status === 'connected' ? `${server.name} added` : `${server.name} saved — not reachable yet`)
    } catch (e) {
      notify(errorMessage(e, 'Could not add the server'))
    }
  }

  async function readFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    if (!f) return
    setSpec(await f.text())
    if (!name.trim()) setName(f.name.replace(/\.(ya?ml|json)$/i, ''))
  }

  return (
    <Modal
      title="Add an MCP server"
      subtitle="Give every helper access to your own tools and data. Pick who can use it per helper in Team."
      width={520}
      onClose={onClose}
      footer={
        <>
          <a
            href="https://modelcontextprotocol.io/introduction"
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-[4px] text-[12.5px] text-muted hover:underline"
          >
            📄 Docs
          </a>
          <div className="flex-1" />
          {result ? (
            <Button variant="primary" height={30} onClick={onClose}>Done</Button>
          ) : (
            <>
              <Button variant="secondary" height={30} onClick={onClose}>Cancel</Button>
              <Button variant="primary" height={30} icon={Server} disabled={!canSubmit || busy} onClick={() => void submit()}>
                {busy ? (mode === 'oas' ? 'Building…' : 'Connecting…') : mode === 'oas' ? 'Build server' : 'Add server'}
              </Button>
            </>
          )}
        </>
      }
    >
      <div className="flex flex-col gap-[16px]">
        {/* How it connects */}
        <div>
          <p className="mb-[8px] text-[11px] font-medium uppercase tracking-[0.8px] text-faint">How it connects</p>
          <div className="flex flex-col gap-[6px]" role="radiogroup" aria-label="How it connects">
            {HOW_ITEMS.map((item) => (
              <button
                key={item.id}
                type="button"
                role="radio"
                aria-checked={mode === item.id}
                disabled={item.soon || !!result}
                onClick={() => setMode(item.id)}
                className={`flex items-start gap-[8px] rounded-base border p-[10px] text-left disabled:cursor-not-allowed ${mode === item.id ? 'border-ink bg-surface' : 'border-line-strong bg-soft'} ${item.soon ? 'opacity-60' : ''}`}
              >
                <span className={`mt-[1px] flex size-[16px] shrink-0 items-center justify-center rounded-full border-2 ${mode === item.id ? 'border-ink bg-ink' : 'border-line-strong bg-surface'}`}>
                  {mode === item.id && <span className="size-[6px] rounded-full bg-white" />}
                </span>
                <div>
                  <p className="text-[13px] font-semibold text-ink">
                    {item.label}
                    {item.soon && <span className="ml-[6px] text-[11px] font-normal text-muted">Coming soon</span>}
                  </p>
                  <p className="text-[12px] text-muted">{item.desc}</p>
                </div>
              </button>
            ))}
          </div>
        </div>

        {!result && (
          <div>
            <p className="mb-[6px] text-[12px] font-medium text-muted">Name</p>
            <TextInput aria-label="Name" value={name} placeholder="e.g. company-db" onChange={setName} className="w-full min-w-0" />
          </div>
        )}

        {mode === 'remote' && !result && (
          <>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">Server URL</p>
              <TextInput aria-label="Server URL" value={url} placeholder="https://mcp.example.com/mcp" onChange={setUrl} className="w-full min-w-0" />
            </div>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">Authentication</p>
              <SelectField aria-label="Authentication" value={auth} options={AUTH} onChange={setAuth} />
            </div>
            {auth === AUTH[1] && (
              <div>
                <p className="mb-[6px] text-[12px] font-medium text-muted">Token</p>
                <TextInput aria-label="Token" type="password" value={token} onChange={setToken} className="w-full min-w-0 font-mono" />
                <p className="mt-[4px] text-[11.5px] text-muted">Stored encrypted. Only sent to this server.</p>
              </div>
            )}
          </>
        )}

        {mode === 'oas' && !result && (
          <>
            <div>
              <p className="mb-[6px] text-[12px] font-medium text-muted">OpenAPI spec (JSON or YAML)</p>
              <textarea
                aria-label="OpenAPI spec"
                value={spec}
                onChange={(e) => setSpec(e.target.value)}
                placeholder="openapi: 3.0.0…"
                rows={7}
                className="w-full rounded-base border border-line-strong bg-soft px-[12px] py-[8px] font-mono text-[12px] text-ink outline-none focus:border-ink"
              />
              <label className="mt-[6px] inline-flex cursor-pointer items-center gap-[6px] text-[12px] text-link hover:underline">
                <input type="file" accept=".json,.yaml,.yml,application/json" className="hidden" onChange={(e) => void readFile(e)} />
                Upload a file
              </label>
            </div>
            {!spec.trim() && (
              <div>
                <p className="mb-[6px] text-[12px] font-medium text-muted">…or the spec URL</p>
                <TextInput aria-label="Spec URL" value={specUrl} placeholder="https://api.example.com/openapi.json" onChange={setSpecUrl} className="w-full min-w-0" />
              </div>
            )}
          </>
        )}

        {result && <ToolsPreview server={result} />}
      </div>
    </Modal>
  )
}

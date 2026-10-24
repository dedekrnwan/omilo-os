import { ChevronDown, ExternalLink } from 'lucide-react'
import type { HelperRecord } from '../teamData'
import type { Tool } from '../teamData'

function PermissionSelect({ tool }: { tool: Tool }) {
  return (
    <button
      type="button"
      className="flex items-center gap-[4px] rounded-md bg-soft px-[8px] py-[4px] text-[12px] text-ink-2 outline-1 -outline-offset-1 outline-line-strong hover:bg-hover transition-colors"
    >
      {tool.permission}
      <ChevronDown size={11} aria-hidden className="text-muted" />
    </button>
  )
}

function ToolToggle({ enabled }: { enabled: boolean }) {
  return (
    <div
      className={`relative h-[18px] w-[30px] rounded-full transition-colors ${enabled ? 'bg-ok' : 'bg-line-strong'}`}
      aria-hidden
    >
      <span
        className={`absolute top-[2px] size-[14px] rounded-full bg-surface shadow-sm transition-transform ${
          enabled ? 'left-[14px]' : 'left-[2px]'
        }`}
      />
    </div>
  )
}

interface ToolsTabProps {
  helper: HelperRecord
}

export function ToolsTab({ helper }: ToolsTabProps) {
  const fromCompany = helper.tools.filter((t) => !t.builtIn)
  const builtIn = helper.tools.filter((t) => t.builtIn)

  return (
    <div className="flex flex-col gap-[20px]">
      {/* Notice */}
      <div className="flex items-start gap-[10px] rounded-md bg-field-indigo px-[12px] py-[10px] outline-1 -outline-offset-1 outline-[#C7D2FE]">
        <span className="text-[14px] mt-[1px]">🔌</span>
        <div className="flex-1">
          <p className="m-0 text-[12.5px] font-medium text-ink">
            Connectors and MCP servers are set up once for the company
          </p>
          <p className="m-0 mt-[2px] text-[12px] text-ink-2">
            Add or remove them in Control panel → Connectors. Here you only decide which ones {helper.name} may use, and how much.
          </p>
        </div>
        <button type="button" className="flex items-center gap-[4px] text-[12px] text-link hover:underline whitespace-nowrap">
          <ExternalLink size={12} aria-hidden />
          Open Connectors
        </button>
      </div>

      {/* From company */}
      {fromCompany.length > 0 && (
        <section>
          <div className="flex items-center gap-[6px] mb-[10px]">
            <span className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase">
              From the company
            </span>
            <span className="text-[11.5px] text-faint">{fromCompany.length} connectors · 1 MCP server</span>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {fromCompany.map((tool) => (
              <div key={tool.name} className="flex items-center gap-[12px] py-[10px]">
                <div className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line-strong text-[14px]">
                  {tool.mcp ? '⚡' : '🔌'}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <div className="flex items-center gap-[6px]">
                    <span className="text-[13px] font-medium text-ink">{tool.name}</span>
                    {tool.mcp && (
                      <span className="rounded-pill bg-field-indigo px-[5px] py-[1px] text-[10px] font-medium text-[#4338CA]">
                        MCP
                      </span>
                    )}
                  </div>
                  <span className="text-[11.5px] text-muted">{tool.description}</span>
                </div>
                <PermissionSelect tool={tool} />
                <ToolToggle enabled={tool.enabled} />
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Built in */}
      {builtIn.length > 0 && (
        <section>
          <div className="flex items-center gap-[6px] mb-[10px]">
            <span className="text-[10.5px] font-medium tracking-[0.55px] text-faint uppercase">
              Built in
            </span>
            <span className="text-[11.5px] text-faint">Come with every helper</span>
          </div>
          <div className="flex flex-col divide-y divide-line">
            {builtIn.map((tool) => (
              <div key={tool.name} className="flex items-center gap-[12px] py-[10px]">
                <div className="flex size-[28px] shrink-0 items-center justify-center rounded-md bg-soft outline-1 -outline-offset-1 outline-line-strong text-[14px]">
                  {tool.name === 'Browser' ? '🌐' : tool.name === 'Web search' ? '🔍' : '⚙️'}
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[13px] font-medium text-ink">{tool.name}</span>
                  <span className="text-[11.5px] text-muted">{tool.description}</span>
                </div>
                <PermissionSelect tool={tool} />
                <ToolToggle enabled={tool.enabled} />
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  )
}

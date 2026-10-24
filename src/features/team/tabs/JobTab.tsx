import { Edit, ExternalLink } from 'lucide-react'
import type { HelperRecord } from '../teamData'

// ── JobTab ────────────────────────────────────────────────────────────────────

interface JobTabProps {
  helper: HelperRecord
}

export function JobTab({ helper }: JobTabProps) {
  return (
    <div className="flex flex-col gap-[24px]">
      {/* Job description */}
      <section>
        <div className="flex items-center justify-between mb-[8px]">
          <div>
            <h3 className="m-0 text-[13px] font-medium text-ink">Job description</h3>
            <p className="m-0 text-[12px] text-muted">
              The one paragraph {helper.name} reads before every conversation.
            </p>
          </div>
          <button
            type="button"
            className="flex items-center gap-[4px] text-[12px] text-muted hover:text-ink transition-colors"
          >
            <Edit size={13} aria-hidden />
            Edit
          </button>
        </div>
        <div className="rounded-md bg-soft px-[16px] py-[12px] outline-1 -outline-offset-1 outline-line-strong font-mono text-[12px] text-ink-2 leading-relaxed whitespace-pre-wrap">
          {helper.description}
        </div>
        <p className="mt-[6px] m-0 text-[11.5px] text-faint">
          Edited by you · 2 days ago · v7
        </p>
      </section>

      {/* Routines */}
      {helper.routines.length > 0 && (
        <section>
          <div className="flex items-center justify-between mb-[8px]">
            <div className="flex items-center gap-[8px]">
              <h3 className="m-0 text-[13px] font-medium text-ink">Routines</h3>
              <span className="text-[12px] text-muted">
                {helper.routines.length === 1
                  ? `Recurring work Chief scheduled for ${helper.name}.`
                  : `Chief also manages ${helper.routines.length} routines for the whole team.`}
              </span>
            </div>
            <button
              type="button"
              className="flex items-center gap-[4px] text-[12px] text-link hover:underline"
            >
              Open in Routines
              <ExternalLink size={11} aria-hidden />
            </button>
          </div>
          <div className="flex flex-col gap-[1px]">
            {helper.routines.map((r) => (
              <div
                key={r.label}
                className="flex items-center gap-[12px] rounded-md px-[12px] py-[9px] hover:bg-soft transition-colors"
              >
                <span className="w-[36px] shrink-0 font-mono text-[12px] font-medium text-muted">
                  {r.time}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[13px] font-medium text-ink">{r.label}</span>
                  <span className="text-[11.5px] text-muted">{r.schedule}</span>
                </div>
                <span className={`text-[12px] ${r.paused ? 'text-faint' : 'text-muted'}`}>
                  {r.paused ? 'Paused' : r.nextRun}
                </span>
                {/* Toggle */}
                <div
                  className={`relative h-[18px] w-[30px] rounded-full transition-colors ${
                    r.paused ? 'bg-line-strong' : 'bg-ok'
                  }`}
                  aria-hidden
                >
                  <span
                    className={`absolute top-[2px] size-[14px] rounded-full bg-surface shadow-sm transition-transform ${
                      r.paused ? 'left-[2px]' : 'translate-x-[12px] left-[2px]'
                    }`}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Working files */}
      <section>
        <h3 className="m-0 text-[13px] font-medium text-ink mb-[2px]">Working files</h3>
        <p className="m-0 mb-[10px] text-[12px] text-muted">
          {helper.name} keeps these up to date as it learns
        </p>
        <div className="grid grid-cols-2 gap-[8px]">
          {helper.workingFiles.map((f) => (
            <button
              key={f.name}
              type="button"
              className="flex items-center gap-[10px] rounded-md px-[12px] py-[10px] outline-1 -outline-offset-1 outline-line-strong bg-surface text-left hover:bg-soft transition-colors"
            >
              <span className="text-[16px]">
                {f.name.startsWith('PERSONA') ? '👤' :
                 f.name.startsWith('STYLE')   ? 'T' :
                 f.name.startsWith('PLAYBOOK') ? '☰' : '🧠'}
              </span>
              <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                <span className="text-[12.5px] font-medium text-ink">{f.name}</span>
                <span className="text-[11.5px] text-muted truncate">{f.description}</span>
              </div>
              <ExternalLink size={12} aria-hidden className="text-faint" />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

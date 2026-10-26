import { CalendarSync, Check, ChevronRight, History, Pencil, Sparkles, X } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from '@tanstack/react-router'
import { Mascot } from '../../../ui/ds/Mascot'
import { FILE_ICON } from '../teamData'
import type { HelperRecord, WorkingFile } from '../teamData'
import { Btn, IconTile, Switch } from '../ui'

function FileCard({
  file,
  active,
  onOpen,
}: {
  file: WorkingFile
  active: boolean
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`flex min-w-0 flex-1 items-center gap-[12px] rounded-lg px-[16px] py-[14px] text-left transition-colors hover:bg-soft ${
        active ? 'outline-2 -outline-offset-2 outline-ink' : 'outline-1 -outline-offset-1 outline-line-strong'
      }`}
    >
      <IconTile icon={FILE_ICON[file.name]} />
      <span className="flex min-w-0 flex-1 flex-col gap-[3px]">
        <span className="font-mono text-[13.5px] font-medium text-ink">{file.name}</span>
        <span className="text-[12.5px] text-muted">{file.description}</span>
      </span>
      <ChevronRight size={16} aria-hidden className="shrink-0 text-muted" />
    </button>
  )
}

/** Job tab — pen ZOLDU / mM9lI / TVKhl / koZok / w6dUO3 / XB1kX "Tab Content". */
export function JobTab({
  helper,
  activeFile,
  onOpenFile,
}: {
  helper: HelperRecord
  activeFile?: WorkingFile['name']
  onOpenFile: (f: WorkingFile['name']) => void
}) {
  const navigate = useNavigate()
  const files = helper.files
  const [editing, setEditing] = useState(false)
  const [jobDesc, setJobDesc] = useState(helper.description)
  const [draft, setDraft] = useState(helper.description)

  const startEdit = () => { setDraft(jobDesc); setEditing(true) }
  const saveEdit = () => { setJobDesc(draft); setEditing(false) }
  const cancelEdit = () => { setDraft(jobDesc); setEditing(false) }

  return (
    <div className="flex w-full flex-col gap-[20px]">
      {/* Job description */}
      <section className="flex w-full flex-col gap-[12px] rounded-lg p-[18px] outline-1 -outline-offset-1 outline-line-strong">
        <div className="flex w-full items-center gap-[8px]">
          <div className="flex min-w-0 flex-1 flex-col gap-[2px]">
            <h3 className="m-0 text-[14px] font-semibold text-ink">Job description</h3>
            <p className="m-0 text-[12.5px] text-muted">
              The one paragraph {helper.name} reads before every conversation.
            </p>
          </div>
          {editing ? (
            <div className="flex items-center gap-[6px]">
              <Btn variant="quiet" icon={X} h={30} onClick={cancelEdit}>Cancel</Btn>
              <Btn icon={Check} h={30} onClick={saveEdit}>Save</Btn>
            </div>
          ) : (
            <Btn variant="quiet" icon={Pencil} h={30} onClick={startEdit}>
              Edit
            </Btn>
          )}
        </div>
        {editing ? (
          <textarea
            autoFocus
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full resize-none rounded-md bg-soft px-[14px] py-[12px] font-mono text-[12.5px] leading-[1.6] text-ink-2 outline-1 -outline-offset-1 outline-ink"
            rows={5}
          />
        ) : (
          <div className="w-full rounded-md bg-soft px-[14px] py-[12px] outline-1 -outline-offset-1 outline-line">
            <p className="m-0 font-mono text-[12.5px] leading-[1.6] text-ink-2">{jobDesc}</p>
          </div>
        )}
        <div className="flex items-center gap-[6px]">
          <History size={12} aria-hidden className="text-muted" />
          <span className="text-[11.5px] text-faint">Edited by you · 2 days ago · v7</span>
        </div>
      </section>

      {/* Routines */}
      <section className="flex w-full flex-col gap-[10px]">
        <div className="flex w-full items-center gap-[8px]">
          <CalendarSync size={15} aria-hidden className="shrink-0 text-muted" />
          <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
            <h3 className="m-0 text-[14px] font-semibold text-ink">Routines</h3>
            <p className="m-0 text-[12.5px] text-muted">{helper.routinesNote}</p>
          </div>
          <button
            type="button"
            onClick={() => void navigate({ to: '/routines' })}
            className="text-[12.5px] font-medium text-link hover:underline"
          >
            Open in Routines ↗
          </button>
        </div>
        {helper.routines.length > 0 ? (
          <div className="flex w-full flex-col rounded-lg outline-1 -outline-offset-1 outline-line-strong">
            {helper.routines.map((r, i) => (
              <div
                key={r.label}
                className={`flex w-full items-center gap-[12px] px-[14px] py-[10px] ${
                  i < helper.routines.length - 1 ? 'shadow-[inset_0_-1px_0_var(--color-line)]' : ''
                }`}
              >
                <span className="flex w-[52px] shrink-0 justify-center rounded-sm bg-soft py-[3px] font-mono text-[12px] font-medium text-ink">
                  {r.time}
                </span>
                <div className="flex min-w-0 flex-1 flex-col gap-[1px]">
                  <span className="text-[13.5px] font-medium text-ink">{r.label}</span>
                  <span className="text-[12px] text-muted">{r.schedule}</span>
                </div>
                <span className={`text-[12px] ${r.nextRun ? 'text-ink-2' : 'text-warn'}`}>
                  {r.nextRun ?? 'Paused'}
                </span>
                <Switch on={!!r.nextRun} label={`${r.label} on`} />
              </div>
            ))}
          </div>
        ) : (
          <div className="flex w-full items-center gap-[10px] rounded-lg bg-soft p-[14px]">
            <Mascot helper size={22} radius={6} area="brand" title="Chief" />
            <p className="m-0 min-w-0 flex-1 text-[12.5px] text-ink-2">{helper.emptyRoutines}</p>
            <Btn icon={Sparkles} h={28} fs={12} onClick={() => void navigate({ to: '/chat' })}>
              Ask Chief
            </Btn>
          </div>
        )}
      </section>

      {/* Working files */}
      <section className="flex w-full flex-col gap-[10px]">
        <div className="flex w-full items-center gap-[8px]">
          <h3 className="m-0 text-[14px] font-semibold text-ink">Working files</h3>
          <span className="text-[12.5px] text-muted">{helper.name} keeps these up to date as it learns</span>
        </div>
        {[files.slice(0, 2), files.slice(2, 4)].map((row, i) => (
          <div key={i} className="flex w-full gap-[12px]">
            {row.map((f) => (
              <FileCard key={f.name} file={f} active={activeFile === f.name} onOpen={() => onOpenFile(f.name)} />
            ))}
          </div>
        ))}
      </section>
    </div>
  )
}

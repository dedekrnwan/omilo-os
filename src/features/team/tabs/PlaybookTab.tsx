import { useState } from 'react'
import { ArrowUpRight, Check, Maximize2, Pencil, X } from 'lucide-react'
import { useNavigate } from '@tanstack/react-router'
import { notify } from '../../../ui/ds/Toaster'
import { Mascot } from '../../../ui/ds/Mascot'
import { useHelperFiles, useSaveHelperFile } from '../../../app/queries'
import { relativeTime } from '../../analytics/format'
import { FILE_ICON } from '../teamData'
import type { HelperRecord, WorkingFile } from '../teamData'
import { Btn, Drawer, DrawerClose, DrawerTitle, IconBtn, IconTile, Segmented } from '../ui'

const MODES = ['View', 'Edit', 'History'] as const

/** Render the markdown-ish working file: "## " / "# " headings, lists, paragraphs. */
function DocBody({ content }: { content: string }) {
  const blocks = content.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  return (
    <>
      {blocks.map((b, i) => {
        if (/^#{1,3} /.test(b)) {
          return (
            <h3 key={i} className="m-0 font-display text-[17px] font-semibold text-ink">
              {b.replace(/^#{1,3} /, '')}
            </h3>
          )
        }
        const lines = b.split('\n')
        if (lines.every((l) => /^(\d+\.|[-•*]) /.test(l.trim()))) {
          return (
            <div key={i} className="flex w-full flex-col gap-[6px]">
              {lines.map((l, j) => {
                const m = l.trim().match(/^(\d+\.|[-•*]) (.*)$/)
                const ordered = !!m && /\d/.test(m[1])
                return (
                  <div key={j} className="flex w-full gap-[8px]">
                    <span className={`text-[13.5px] leading-[1.55] text-muted ${ordered ? 'font-mono' : ''}`}>
                      {ordered ? m![1] : '•'}
                    </span>
                    <span className="min-w-0 flex-1 text-[13.5px] leading-[1.55] text-ink-2">{m ? m[2] : l}</span>
                  </div>
                )
              })}
            </div>
          )
        }
        return (
          <p key={i} className="m-0 text-[13.5px] leading-[1.6] whitespace-pre-wrap text-ink-2">
            {b}
          </p>
        )
      })}
    </>
  )
}

function who(updatedBy: string | null, helperName: string): string {
  if (!updatedBy) return '—'
  if (updatedBy.startsWith('operator:')) return 'you'
  return helperName
}

/** Working-file doc drawer — pen vDIEL (Doc Drawer TfYVJ, 520 wide). Reads/edits the helper's memory doc. */
export function PlaybookDrawer({
  helper,
  file = 'PLAYBOOK.md',
  onClose,
}: {
  helper: HelperRecord
  file?: WorkingFile['name']
  onClose: () => void
}) {
  const navigate = useNavigate()
  const { data: files = [], isLoading } = useHelperFiles(helper.id)
  const save = useSaveHelperFile(helper.id)
  const doc = files.find((f) => f.name === file)
  const [mode, setMode] = useState<(typeof MODES)[number]>('View')
  const [editContent, setEditContent] = useState('')

  const handleModeChange = (m: (typeof MODES)[number]) => {
    if (m === 'Edit') setEditContent(doc?.content ?? '')
    setMode(m)
  }
  const saveEdit = () =>
    save.mutate(
      { name: file, content: editContent },
      {
        onSuccess: () => {
          notify(`${file} saved`)
          setMode('View')
        },
        onError: () => notify(`Couldn't save ${file}`),
      },
    )

  return (
    <Drawer
      width={520}
      label={file}
      onClose={onClose}
      bodyClass=""
      head={
        <>
          <IconTile icon={FILE_ICON[file]} />
          <DrawerTitle mono title={file} sub={`${helper.name} · ${doc?.description ?? ''}`} />
          <IconBtn icon={Maximize2} label="Open full screen" onClick={() => void navigate({ to: '/docs' })} />
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
              void navigate({ to: '/docs' })
            }}
          >
            Open in Docs
          </Btn>
          <span className="h-px flex-1" />
          {mode === 'Edit' ? (
            <>
              <Btn variant="quiet" icon={X} onClick={() => setMode('View')}>Cancel</Btn>
              <Btn variant="primary" icon={Check} onClick={saveEdit} disabled={save.isPending}>
                {save.isPending ? 'Saving…' : 'Save'}
              </Btn>
            </>
          ) : (
            <>
              <span className="text-[11.5px] text-faint">Your edits always win over {helper.name}&apos;s</span>
              <Btn variant="primary" icon={Pencil} onClick={() => handleModeChange('Edit')}>
                Edit
              </Btn>
            </>
          )}
        </>
      }
    >
      <div className="flex w-full items-center gap-[10px] px-[20px] py-[10px]">
        <Segmented items={MODES} value={mode} onChange={handleModeChange} />
        <span className="h-px flex-1" />
        {doc?.updatedAt && (
          <span className="flex items-center gap-[6px]">
            <Mascot helper size={18} radius={7} area={helper.area} />
            <span className="text-[12px] text-muted">
              Updated by {who(doc.updatedBy, helper.name)} · {relativeTime(doc.updatedAt)}
            </span>
          </span>
        )}
      </div>
      {mode === 'Edit' && (
        <div className="flex w-full flex-1 flex-col px-[28px] pt-[8px] pb-[24px]">
          <textarea
            autoFocus
            aria-label={`${file} content`}
            value={editContent}
            onChange={(e) => setEditContent(e.target.value)}
            className="w-full flex-1 resize-none rounded-md bg-soft px-[14px] py-[12px] font-mono text-[12.5px] leading-[1.6] text-ink-2 outline-1 -outline-offset-1 outline-ink"
            rows={16}
          />
        </div>
      )}
      {mode === 'View' && (
        <div className="flex w-full flex-1 flex-col gap-[12px] px-[28px] pt-[8px] pb-[24px]">
          {isLoading && <p className="m-0 text-[13px] text-muted">Loading…</p>}
          {!isLoading && !doc?.content && (
            <p className="m-0 text-[13.5px] text-muted">
              {helper.name} hasn&apos;t written {file} yet. It fills this in as it learns — or click Edit to start it.
            </p>
          )}
          {doc?.content && <DocBody content={doc.content} />}
        </div>
      )}
      {mode === 'History' && (
        <div className="flex w-full flex-1 flex-col gap-[8px] px-[28px] pt-[8px] pb-[24px]">
          {doc?.updatedAt ? (
            <div className="flex w-full items-center gap-[8px] rounded-md bg-soft px-[12px] py-[10px]">
              <Mascot helper size={18} radius={7} area={helper.area} />
              <span className="min-w-0 flex-1 text-[13px] text-ink-2">
                Last edited by {who(doc.updatedBy, helper.name)}
              </span>
              <span className="font-mono text-[11.5px] text-muted">{new Date(doc.updatedAt).toLocaleString()}</span>
            </div>
          ) : (
            <p className="m-0 text-[13px] text-muted">No edits yet.</p>
          )}
          <p className="m-0 text-[12px] text-faint">Only the latest version is kept for now.</p>
        </div>
      )}
    </Drawer>
  )
}

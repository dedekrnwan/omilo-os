import { useEffect } from 'react'
import { Info } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Mascot } from '../../../../ui/ds/Mascot'
import { DRAFT_NOTES } from './data'
import { EditorFrame } from './EditorFrame'
import { FlowCanvas } from './FlowCanvas'
import { Inspector } from './Inspector'
import { Palette } from './Palette'
import { useFlow, useFlowStore } from './store'
import { TestRunPanel } from './TestRunPanel'
import { stepMenu } from './stepMenu'

/** `?state=test` opens the test-run sheet (used for visual checks and deep links). */
function useTestFromUrl(flowId: string) {
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('state') === 'test') {
      useFlowStore.setState((s) => ({
        flows: { ...s.flows, [flowId]: { ...useFlowStore.getState().get(flowId), test: 'done', testStep: 5 } },
      }))
    }
  }, [flowId])
}

function Editor({ flowId, draft }: { flowId: string; draft: boolean }) {
  const navigate = useNavigate()
  const f = useFlow(flowId)
  const s = useFlowStore()
  useTestFromUrl(flowId)

  const runsPill = !draft && f.runs.length > 0 && (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => void navigate({ to: '/flows/$flowId/runs', params: { flowId } })}
      className="absolute top-[16px] left-[16px] flex h-[27px] items-center gap-[8px] rounded-full bg-surface pr-[11px] pl-[10px] text-[12.5px] text-ink-2 shadow-[0_1px_2px_#0C0A090A] outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
    >
      <span className="size-[7px] rounded-full bg-ok" aria-hidden />
      {f.enabled ? 'Last run 12m ago · 51s · $0.018' : 'Off · last run 12m ago'}
    </button>
  )

  const notes = draft
    ? DRAFT_NOTES.map((n) => (
        <div
          key={n.id}
          className="pointer-events-none absolute flex gap-[6px] rounded-sm bg-[#EEF2FF] px-[8px] py-[6px] text-[11.5px] leading-[16px] text-[#4338CA]"
          style={{ left: n.x, top: n.y, width: n.w }}
        >
          <Info size={12} aria-hidden className="mt-[2px] shrink-0" />
          {n.text}
        </div>
      ))
    : null

  const draftCard = draft && (
    <section
      aria-label="About this draft"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-[636px] left-[556px] flex w-[244px] gap-[10px] rounded-lg bg-surface py-[12px] pr-[12px] pl-[12px] shadow-[0_6px_18px_#0C0A0914] outline-1 -outline-offset-1 outline-[#DCE2F8]"
    >
      <Mascot size={32} radius={9} area="dev" className="mt-[28px] shrink-0" />
      <div className="flex min-w-0 flex-col gap-[4px]">
        <h3 className="m-0 text-[13px] leading-[16px] font-semibold text-ink">Dev drafted this from 4 triages you did by hand</h3>
        <p className="m-0 text-[12px] leading-[17px] text-muted">
          Check each step, run a test on last week’s failures, then turn it on. Nothing runs until you do.
        </p>
        <div className="mt-[6px] -ml-[42px]">
          <button
            type="button"
            onClick={() => {
              s.setDraft(flowId, 'discarded')
              void navigate({ to: '/flows' })
            }}
            className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
          >
            Discard
          </button>
        </div>
      </div>
    </section>
  )

  return (
    <EditorFrame flowId={flowId} tab="canvas" draft={draft} onTestRun={() => s.startTest(flowId)}>
      <Palette onAdd={(item) => s.addStep(flowId, item)} />
      <FlowCanvas
        graph={f.graph}
        selected={f.selected}
        draft={draft}
        showLast={!draft}
        onSelect={(id) => s.select(flowId, id)}
        onMove={(id, x, y, commit) => s.moveNode(flowId, id, x, y, commit)}
        onDrop={(item, at) => s.addStep(flowId, item, at)}
        onInsert={(edge, item) => s.insertOnEdge(flowId, edge, item)}
        onConnect={(from, to) => s.addEdge(flowId, from, to)}
        onUndo={() => s.undo(flowId)}
        onRedo={() => s.redo(flowId)}
        canUndo={f.past.length > 0}
        canRedo={f.future.length > 0}
        onDelete={(id) => s.removeStep(flowId, id)}
        nodeMenu={(n) => stepMenu(flowId, n)}
        layer={
          <>
            {notes}
            {draftCard}
          </>
        }
        overlay={
          <>
            {runsPill}
          </>
        }
      />
      <Inspector flowId={flowId} />
      {f.test !== 'idle' && (
        <TestRunPanel
          step={f.testStep}
          done={f.test === 'done'}
          onClose={() => s.closeTest(flowId)}
          onRunAgain={() => s.startTest(flowId)}
          onViewLog={() => void navigate({ to: '/flows/$flowId/runs', params: { flowId } })}
          publishLabel={draft ? 'Turn on flow' : 'Publish changes'}
          onPublish={() => {
            s.closeTest(flowId)
            if (draft) {
              s.setDraft(flowId, 'on')
              void navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
            } else s.publish(flowId)
          }}
        />
      )}
    </EditorFrame>
  )
}

/** pen `Office · Flows · Canvas` (ck4Kt) + `· Test run result` (emtFw). */
export function FlowCanvasPage() {
  const { flowId } = useParams({ strict: false }) as { flowId: string }
  return <Editor flowId={flowId} draft={false} />
}

/** pen `Office · Flows · Draft from Suggested` (SgKgq). */
export function FlowDraftPage() {
  const { flowId } = useParams({ strict: false }) as { flowId: string }
  return <Editor flowId={flowId} draft />
}

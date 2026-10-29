import { useEffect, useMemo } from 'react'
import { Info } from 'lucide-react'
import { useNavigate, useParams } from '@tanstack/react-router'
import { Mascot } from '../../../../ui/ds/Mascot'
import { notify } from '../../../../ui/ds/Toaster'
import { useDeleteFlow, useFlowRun, useFlowRunAction, useFlowRuns } from '../../../../app/queries'
import { EditorFrame } from './EditorFrame'
import { FlowCanvas } from './FlowCanvas'
import { Inspector } from './Inspector'
import { Palette } from './Palette'
import { lastByNode } from './runs'
import { formatCost, formatDuration, formatRelative } from '../runsAdapter'
import { useFlow, useFlowStore } from './store'
import { TestRunPanel } from './TestRunPanel'
import { stepMenu } from './stepMenu'
import { usePublish, useAutosave, useSaveGraph, useSeedFlow } from './useFlowSync'

/** `?state=test` runs a real test on open (deep link from the board's "Test run"). */
function useTestFromUrl(flowId: string) {
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('state') === 'test') {
      useFlowStore.getState().startTest(flowId)
    }
  }, [flowId])
}

/** Runs the test the store asked for: save the canvas, POST /test-run, show the result. */
function useTestRunner(flowId: string) {
  const f = useFlow(flowId)
  const save = useSaveGraph(flowId)
  const { mutateAsync: act } = useFlowRunAction()
  useEffect(() => {
    if (f.test !== 'requested' || !f.hydrated) return
    const st = useFlowStore.getState()
    st.setTest(flowId, 'running', null)
    void (async () => {
      try {
        await save()
        const run = await act({ kind: 'test', flowId })
        useFlowStore.getState().setTest(flowId, 'done', run.id)
      } catch {
        useFlowStore.getState().closeTest(flowId)
        notify('Test run failed to start — try again')
      }
    })()
  }, [f.test, f.hydrated, flowId, save, act])
}

function Editor({ flowId, draft }: { flowId: string; draft: boolean }) {
  const navigate = useNavigate()
  const f = useFlow(flowId)
  const s = useFlowStore()
  const { data: liveFlow, isLoading, isError } = useSeedFlow(flowId)
  const { data: runs = [] } = useFlowRuns(flowId)
  const { data: testRun } = useFlowRun(flowId, f.testRunId ?? undefined, { poll: true })
  const deleteFlow = useDeleteFlow()
  const { publish } = usePublish(flowId)
  useAutosave(flowId)
  useTestFromUrl(flowId)
  useTestRunner(flowId)

  const lastRun = runs[0]
  const last = useMemo(() => lastByNode(lastRun), [lastRun])
  // The canvas shows each step's last-run time; it isn't part of the saved graph.
  const graph = useMemo(
    () => ({ ...f.graph, nodes: f.graph.nodes.map((n) => (last[n.id] ? { ...n, last: last[n.id] } : n)) }),
    [f.graph, last],
  )

  const runsPill = !draft && lastRun && (
    <button
      type="button"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={() => void navigate({ to: '/flows/$flowId/runs', params: { flowId } })}
      className="absolute top-[16px] left-[16px] flex h-[27px] items-center gap-[8px] rounded-full bg-surface pr-[11px] pl-[10px] text-[12.5px] text-ink-2 shadow-[0_1px_2px_#0C0A090A] outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
    >
      <span className={`size-[7px] rounded-full ${lastRun.status === 'failed' ? 'bg-bad' : 'bg-ok'}`} aria-hidden />
      {f.enabled
        ? `Last run ${formatRelative(lastRun.startedAt, Date.now())} · ${[formatDuration(lastRun.duration), formatCost(lastRun.costCredits)].filter((x) => x !== '—').join(' · ')}`
        : `Off · last run ${formatRelative(lastRun.startedAt, Date.now())}`}
    </button>
  )

  const empty = f.hydrated && f.graph.nodes.length === 0 && (
    <div className="pointer-events-none absolute top-[120px] left-1/2 flex w-[260px] -translate-x-1/2 gap-[6px] rounded-sm bg-[#EEF2FF] px-[8px] py-[6px] text-[11.5px] leading-[16px] text-[#4338CA]">
      <Info size={12} aria-hidden className="mt-[2px] shrink-0" />
      Start with a trigger from the left, then add the steps that follow.
    </div>
  )

  const draftCard = draft && (
    <section
      aria-label="About this draft"
      onPointerDown={(e) => e.stopPropagation()}
      className="absolute top-[636px] left-[556px] flex w-[244px] gap-[10px] rounded-lg bg-surface py-[12px] pr-[12px] pl-[12px] shadow-[0_6px_18px_#0C0A0914] outline-1 -outline-offset-1 outline-[#DCE2F8]"
    >
      <Mascot size={32} radius={9} area="brand" className="mt-[28px] shrink-0" />
      <div className="flex min-w-0 flex-col gap-[4px]">
        <h3 className="m-0 text-[13px] leading-[16px] font-semibold text-ink">This flow is a draft</h3>
        <p className="m-0 text-[12px] leading-[17px] text-muted">
          Check each step, run a test, then turn it on. Nothing runs until you do.
        </p>
        <div className="mt-[6px] -ml-[42px]">
          <button
            type="button"
            onClick={() =>
              deleteFlow.mutate(flowId, {
                onSuccess: () => {
                  notify('Draft discarded')
                  void navigate({ to: '/flows' })
                },
                onError: () => notify('Could not discard — try again'),
              })
            }
            className="h-[28px] rounded-btn bg-surface px-[10px] text-[12.5px] font-medium text-ink outline-1 -outline-offset-1 outline-line-strong hover:bg-soft"
          >
            Discard
          </button>
        </div>
      </div>
    </section>
  )

  if (isError || (!isLoading && liveFlow === null)) {
    return (
      <EditorFrame flowId={flowId} tab="canvas" draft={draft}>
        <div role="alert" className="flex flex-1 flex-col items-center justify-center gap-[6px] text-center">
          <p className="m-0 text-[13.5px] font-medium text-ink">{isError ? 'Could not load this flow' : 'Flow not found'}</p>
          <p className="m-0 text-[13px] text-muted">{isError ? 'Please refresh to try again.' : 'It may have been deleted.'}</p>
        </div>
      </EditorFrame>
    )
  }

  return (
    <EditorFrame flowId={flowId} tab="canvas" draft={draft} onTestRun={() => s.startTest(flowId)}>
      <Palette onAdd={(item) => s.addStep(flowId, item)} />
      <FlowCanvas
        graph={graph}
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
            {empty}
            {draftCard}
          </>
        }
        overlay={<>{runsPill}</>}
      />
      <Inspector flowId={flowId} />
      {f.test !== 'idle' && (
        <TestRunPanel
          run={f.test === 'done' ? testRun ?? null : null}
          onClose={() => s.closeTest(flowId)}
          onRunAgain={() => s.startTest(flowId)}
          onViewLog={() => void navigate({ to: '/flows/$flowId/runs', params: { flowId } })}
          publishLabel={draft ? 'Turn on flow' : 'Publish changes'}
          onPublish={async () => {
            s.closeTest(flowId)
            await publish()
            if (draft) void navigate({ to: '/flows/$flowId/canvas', params: { flowId } })
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

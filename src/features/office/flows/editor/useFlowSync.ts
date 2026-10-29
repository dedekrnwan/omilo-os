// Server sync for the flow editor: seed from GET /v1/flows/{id}, autosave canvas
// edits with PATCH {nodes, edges}, and publish (save first, then POST /publish,
// which raises a flow_publish decision in the Inbox).

import { useCallback, useEffect } from 'react'
import { useFlow as useFlowQuery, usePublishFlow, useUpdateFlow } from '../../../../app/queries'
import { notify } from '../../../../ui/ds/Toaster'
import { toApiGraph } from './graphMap'
import { useFlow, useFlowStore } from './store'

const AUTOSAVE_MS = 800

/** Seed the editor store from the live flow whenever it (re)loads. */
export function useSeedFlow(flowId: string) {
  const query = useFlowQuery(flowId)
  const { data: liveFlow } = query
  useEffect(() => {
    if (liveFlow) useFlowStore.getState().seed(flowId, liveFlow)
  }, [flowId, liveFlow])
  return query
}

/** Save the canvas now (no-op when there are no unsaved edits). */
export function useSaveGraph(flowId: string) {
  const { mutateAsync: update } = useUpdateFlow()
  return useCallback(async () => {
    const f = useFlowStore.getState().get(flowId)
    if (!f.dirty || !f.hydrated) return
    const graph = toApiGraph(f.graph.nodes, f.graph.edges, f.ai)
    const saved = await update({ id: flowId, input: graph })
    // Only clear `dirty` if nothing changed while the request was in flight.
    const now = useFlowStore.getState().get(flowId)
    if (now.graph === f.graph && now.ai === f.ai) useFlowStore.getState().markSaved(flowId, saved.version ?? null)
    else useFlowStore.setState((s) => ({ flows: { ...s.flows, [flowId]: { ...now, serverVersion: saved.version ?? null } } }))
  }, [flowId, update])
}

/** Debounced autosave of canvas edits. */
export function useAutosave(flowId: string) {
  const f = useFlow(flowId)
  const save = useSaveGraph(flowId)
  useEffect(() => {
    if (!f.dirty || !f.hydrated) return
    const t = setTimeout(() => {
      save().catch(() => notify('Could not save your changes — retrying on the next edit'))
    }, AUTOSAVE_MS)
    return () => clearTimeout(t)
  }, [f.graph, f.ai, f.dirty, f.hydrated, save])
}

/** Save, then ask for publish approval. Resolves with the proposal id (if any). */
export function usePublish(flowId: string) {
  const save = useSaveGraph(flowId)
  const { mutateAsync: publishFlow, isPending } = usePublishFlow()
  const run = useCallback(async () => {
    try {
      await save()
      const proposal = await publishFlow(flowId)
      notify('Sent for approval — approve it in your Inbox')
      return proposal?.id
    } catch {
      notify('Could not publish — try again')
      return undefined
    }
  }, [flowId, publishFlow, save])
  return { publish: run, pending: isPending }
}

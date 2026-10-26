import { Copy, CopyPlus, FlaskConical, Pencil, SquareMousePointer, Trash2 } from 'lucide-react'
import type { MenuEntries } from '../../../../ui/ds/ItemMenu'
import { notify } from '../../../../ui/ds/Toaster'
import { PALETTE } from './data'
import type { FlowNode } from './data'
import { PALETTE_ICON } from './icons'
import { useFlowStore } from './store'

/** A step's actions — the canvas right-click menu and the inspector ⋯ share this list. */
export function stepMenu(flowId: string, node: FlowNode, opts: { onTest?: () => void; inInspector?: boolean } = {}): MenuEntries {
  const s = useFlowStore.getState()
  return [
    !opts.inInspector && { label: 'Edit step', icon: SquareMousePointer, onSelect: () => s.select(flowId, node.id) },
    { label: 'Rename', icon: Pencil, onSelect: () => s.setRenaming(flowId, node.id) },
    opts.onTest && { label: 'Test this step', icon: FlaskConical, onSelect: opts.onTest },
    { type: 'separator' },
    {
      type: 'sub',
      label: 'Add step after',
      icon: CopyPlus,
      items: PALETTE.flatMap((g) => g.items)
        .filter((i) => i.kind !== 'trigger')
        .map((item) => ({
          label: item.label,
          icon: PALETTE_ICON[item.icon],
          onSelect: () => {
            s.select(flowId, node.id)
            s.addStep(flowId, item)
          },
        })),
    },
    { label: 'Duplicate', icon: Copy, onSelect: () => s.duplicateStep(flowId, node.id) },
    { type: 'separator' },
    {
      label: 'Delete step',
      icon: Trash2,
      hint: '⌫',
      danger: true,
      onSelect: () => {
        s.removeStep(flowId, node.id)
        notify(`Deleted “${node.title}”`, () => useFlowStore.getState().undo(flowId))
      },
    },
  ]
}

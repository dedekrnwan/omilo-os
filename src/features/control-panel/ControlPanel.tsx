import { useState } from 'react'
import { Inset } from '../../ui/ds/Frame'
import { ControlPanelNav } from './ControlPanelNav'
import { SectionGeneral } from './sections/SectionGeneral'
import { SectionHandbook } from './sections/SectionHandbook'
import { SectionMembers } from './sections/SectionMembers'
import { SectionChannels } from './sections/SectionChannels'
import { SectionSafety } from './sections/SectionSafety'
import { SectionAiEngine } from './sections/SectionAiEngine'
import { SectionAiAccounts } from './sections/SectionAiAccounts'
import { SectionKnowledge } from './sections/SectionKnowledge'
import { SectionConnectors } from './sections/SectionConnectors'
import { SectionSkills } from './sections/SectionSkills'
import { SectionUsage } from './sections/SectionUsage'
import { SectionActivity } from './sections/SectionActivity'
import { SectionData } from './sections/SectionData'
import { SectionAccount } from './sections/SectionAccount'
import { SectionNotifications } from './sections/SectionNotifications'
import { DialogDeleteWorkspace } from './dialogs/DialogDeleteWorkspace'
import { DialogInvite } from './dialogs/DialogInvite'
import { DialogAddSeats } from './dialogs/DialogAddSeats'
import { DialogConnectKey } from './dialogs/DialogConnectKey'
import { DialogAddMcp } from './dialogs/DialogAddMcp'
import { DialogWriteSkill } from './dialogs/DialogWriteSkill'
import { DialogChangePlan } from './dialogs/DialogChangePlan'
import { DialogBuyCredits } from './dialogs/DialogBuyCredits'
import type { ControlPanelSection, DialogKind } from './types'

interface Props {
  /** Initial section to show; defaults to 'general'. */
  section?: ControlPanelSection
  onSection?: (s: ControlPanelSection) => void
}

/** Renders the correct section screen based on the active section id. */
function SectionContent({
  section,
  onDialog,
}: {
  section: ControlPanelSection
  onDialog: (d: DialogKind) => void
}) {
  switch (section) {
    case 'general':      return <SectionGeneral onDialog={onDialog} />
    case 'handbook':     return <SectionHandbook />
    case 'members':      return <SectionMembers onDialog={onDialog} />
    case 'channels':     return <SectionChannels />
    case 'safety':       return <SectionSafety />
    case 'ai-engine':    return <SectionAiEngine />
    case 'ai-accounts':  return <SectionAiAccounts onDialog={onDialog} />
    case 'knowledge':    return <SectionKnowledge />
    case 'connectors':   return <SectionConnectors onDialog={onDialog} />
    case 'skills':       return <SectionSkills onDialog={onDialog} />
    case 'usage':        return <SectionUsage onDialog={onDialog} />
    case 'activity':     return <SectionActivity />
    case 'data':         return <SectionData />
    case 'account':      return <SectionAccount />
    case 'notifications': return <SectionNotifications />
    default:             return <SectionGeneral onDialog={onDialog} />
  }
}

/** Renders the appropriate dialog overlay based on the active dialog kind. */
function DialogOverlay({
  dialog,
  onClose,
}: {
  dialog: DialogKind
  onClose: () => void
}) {
  if (!dialog) return null
  switch (dialog) {
    case 'delete-workspace': return <DialogDeleteWorkspace onClose={onClose} />
    case 'invite':           return <DialogInvite onClose={onClose} />
    case 'seats-full':       return <DialogInvite onClose={onClose} seatsFull />
    case 'add-seats':        return <DialogAddSeats onClose={onClose} />
    case 'connect-key':      return <DialogConnectKey onClose={onClose} />
    case 'add-mcp':          return <DialogAddMcp onClose={onClose} />
    case 'build-oas':        return <DialogAddMcp onClose={onClose} mode="oas" />
    case 'write-skill':      return <DialogWriteSkill onClose={onClose} />
    case 'change-plan':      return <DialogChangePlan onClose={onClose} />
    case 'buy-credits':      return <DialogBuyCredits onClose={onClose} />
    default:                 return null
  }
}

/**
 * Control Panel — a full-screen settings surface opened from the gear in the rail.
 * Rendered inside the app Shell's <Outlet />; fills Rail's right side via Inset.
 *
 * Layout: ControlPanelNav (144px) | divider | SectionContent (flex-1)
 * Section selection is held in local state (+ optional prop/callback for URL sync).
 */
export function ControlPanel({ section: initialSection = 'general', onSection }: Props) {
  const [section, setSection] = useState<ControlPanelSection>(initialSection)
  const [dialog, setDialog] = useState<DialogKind>(null)

  function handleSection(s: ControlPanelSection) {
    setSection(s)
    onSection?.(s)
  }

  return (
    <Inset label="Control panel">
      <div className="flex h-full w-full overflow-hidden">
        {/* Left nav */}
        <ControlPanelNav section={section} onSection={handleSection} />

        {/* Vertical divider */}
        <div className="w-px shrink-0 bg-line-strong" />

        {/* Content pane */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <SectionContent section={section} onDialog={setDialog} />
        </div>
      </div>

      {/* Dialog overlay */}
      <DialogOverlay dialog={dialog} onClose={() => setDialog(null)} />
    </Inset>
  )
}

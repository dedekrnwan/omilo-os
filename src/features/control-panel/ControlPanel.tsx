import { useState } from 'react'
import { Inset } from '../../ui/ds/Frame'
import { ControlPanelSidebar } from './ControlPanelSidebar'
import { SectionGeneral } from './sections/SectionGeneral'
import { SectionHandbook } from './sections/SectionHandbook'
import { SectionMembers } from './sections/SectionMembers'
import { SectionChannels } from './sections/SectionChannels'
import { SectionSafety } from './sections/SectionSafety'
import { SectionAiEngine } from './sections/SectionAiEngine'
import { SectionAiAccounts } from './sections/SectionAiAccounts'
import { SectionKnowledge } from './sections/SectionKnowledge'
import { SectionConnectors } from './sections/SectionConnectors'
import { SectionMcpTokens } from './sections/SectionMcpTokens'
import { SectionSkills } from './sections/SectionSkills'
import { SectionUsage } from './sections/SectionUsage'
import { SectionActivity } from './sections/SectionActivity'
import { SectionData } from './sections/SectionData'
import { SectionAccount } from './sections/SectionAccount'
import { SectionNotifications } from './sections/SectionNotifications'
import { DialogDeleteWorkspace } from './dialogs/DialogDeleteWorkspace'
import { DialogInvite } from './dialogs/DialogInvite'
import { DialogAddSeats } from './dialogs/DialogAddSeats'
import { DialogPayMayar } from './dialogs/DialogPayMayar'
import { DialogPlanMax } from './dialogs/DialogPlanMax'
import { DialogConnectKey } from './dialogs/DialogConnectKey'
import { DialogAddHarness } from './dialogs/DialogAddHarness'
import { DialogConnectDrive } from './dialogs/DialogConnectDrive'
import { DialogAddMcp } from './dialogs/DialogAddMcp'
import { DialogWriteSkill } from './dialogs/DialogWriteSkill'
import { DialogChangePlan } from './dialogs/DialogChangePlan'
import { DIALOG_KINDS } from './types'
import type { ControlPanelSection, DialogKind, PageVariant } from './types'
import type { DialogKind as LegacyDialogKind } from './legacyTypes'
import type { PendingPayment } from './dialogs/DialogPayMayar'

export interface SectionProps {
  onDialog: (d: DialogKind) => void
  variant?: PageVariant
  onVariant?: (v: PageVariant) => void
}

interface Props {
  section?: ControlPanelSection
  onSection?: (s: ControlPanelSection) => void
  /** Initial overlay (from `?state=`). */
  dialog?: DialogKind
  /** Page variant (from `?state=`), e.g. self-hosted. */
  variant?: PageVariant
}

function SectionContent({ section, ...p }: SectionProps & { section: ControlPanelSection }) {
  // Sections not yet rebuilt to the v2 design still use the legacy dialog kinds.
  const legacy = (d: LegacyDialogKind) =>
    p.onDialog(DIALOG_KINDS.includes(d as never) ? (d as DialogKind) : null)
  switch (section) {
    case 'general':       return <SectionGeneral {...p} />
    case 'handbook':      return <SectionHandbook {...p} />
    case 'members':       return <SectionMembers {...p} />
    case 'channels':      return <SectionChannels />
    case 'safety':        return <SectionSafety />
    case 'ai-engine':     return <SectionAiEngine />
    case 'ai-accounts':   return <SectionAiAccounts onDialog={legacy} />
    case 'knowledge':     return <SectionKnowledge />
    case 'connectors':    return <SectionConnectors onDialog={legacy} />
    case 'mcp-tokens':    return <SectionMcpTokens />
    case 'skills':        return <SectionSkills onDialog={legacy} />
    case 'usage':         return <SectionUsage onDialog={legacy} />
    case 'activity':      return <SectionActivity />
    case 'data':          return <SectionData />
    case 'account':       return <SectionAccount />
    case 'notifications': return <SectionNotifications />
    default:              return <SectionGeneral {...p} />
  }
}

function DialogOverlay({
  dialog,
  onClose,
  onDialog,
  payment,
  onPayment,
}: {
  dialog: DialogKind
  onClose: () => void
  onDialog: (d: DialogKind) => void
  payment: PendingPayment | null
  onPayment: (p: PendingPayment) => void
}) {
  const startPayment = (p: PendingPayment) => {
    onPayment(p)
    onDialog('pay-mayar')
  }
  switch (dialog) {
    case 'delete-workspace': return <DialogDeleteWorkspace onClose={onClose} />
    case 'invite':           return <DialogInvite onClose={onClose} onDialog={onDialog} onPayment={startPayment} />
    case 'seats-full':       return <DialogInvite onClose={onClose} onDialog={onDialog} onPayment={startPayment} seatsFull />
    case 'add-seats':        return <DialogAddSeats onClose={onClose} onPay={startPayment} />
    case 'pay-mayar':        return <DialogPayMayar onClose={onClose} payment={payment} />
    case 'plan-max':         return <DialogPlanMax onClose={onClose} onDialog={onDialog} />
    case 'connect-key':      return <DialogConnectKey onClose={onClose} />
    case 'add-harness':      return <DialogAddHarness onClose={onClose} onDialog={onDialog} />
    case 'add-mcp':          return <DialogAddMcp onClose={onClose} />
    case 'build-oas':        return <DialogAddMcp onClose={onClose} mode="oas" />
    case 'write-skill':      return <DialogWriteSkill onClose={onClose} />
    case 'change-plan':      return <DialogChangePlan onClose={onClose} />
    case 'connect-drive':    return <DialogConnectDrive onClose={onClose} />
    // oas-tools: not built yet
    default:                 return null
  }
}

/**
 * Control panel (pen `Control panel · …` screens): Control Panel Sidebar (232)
 * next to the Rail, then the Inset with Topbar · page · save bar.
 * Props seed the initial state; the route remounts it (key) when the URL changes.
 */
export function ControlPanel({ section: initialSection = 'general', onSection, dialog: initialDialog = null, variant: initialVariant = null }: Props) {
  const [section, setSection] = useState<ControlPanelSection>(initialSection)
  const [dialog, setDialog] = useState<DialogKind>(initialDialog)
  const [variant, setVariant] = useState<PageVariant>(initialVariant)
  const [payment, setPayment] = useState<PendingPayment | null>(null)

  function handleSection(s: ControlPanelSection) {
    setSection(s)
    setVariant(null)
    onSection?.(s)
  }

  return (
    <>
      <ControlPanelSidebar section={section} onSection={handleSection} />
      <Inset label="Control panel">
        <SectionContent section={section} onDialog={setDialog} variant={variant} onVariant={setVariant} />
      </Inset>
      <DialogOverlay dialog={dialog} onClose={() => setDialog(null)} onDialog={setDialog} payment={payment} onPayment={setPayment} />
    </>
  )
}

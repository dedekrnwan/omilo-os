import { useEffect } from 'react'
import { createPortal } from 'react-dom'
import { UserMinus } from 'lucide-react'
import { Mascot } from '../../ui/ds/Mascot'
import { helperColor } from '../../ui/tokens'
import type { HelperArea } from '../../core/domain/types'
import { Btn } from './ui'

interface LetGoHelper {
  name: string
  area: HelperArea
}

/** Let go — pen HX7PZ (Confirm Dialog x70TQk, worried mascot). */
export function LetGoDialog({ helper, onClose, onLetGo }: { helper: LetGoHelper; onClose: () => void; onLetGo: () => void }) {
  const n = helper.name
  const handleLetGo = () => {
    onLetGo()
    onClose()
  }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const c = helperColor[helper.area]
  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-[#0C0A0940]" onClick={onClose} aria-hidden />
      <div
        role="alertdialog"
        aria-modal="true"
        aria-label={`Let ${n} go?`}
        className="relative flex w-[420px] flex-col items-center rounded-dialog bg-surface px-[24px] pt-[26px] pb-[20px] shadow-[0_30px_80px_#1C191747]"
      >
        <div
          className="flex size-[104px] items-center justify-center rounded-[37px]"
          style={{
            background: `radial-gradient(ellipse 50% 50% at 50% 35%, color-mix(in srgb, ${c} 10%, white) 0%, color-mix(in srgb, ${c} 5%, white) 60%, transparent 70%)`,
          }}
        >
          <Mascot helper size={72} radius={18} area={helper.area} mood="worried" title={n} />
        </div>
        <div className="h-[12px]" />
        <h2 className="m-0 font-serif text-[22px] leading-[1.25] font-medium tracking-[-0.22px] text-ink">
          Let {n} go?
        </h2>
        <div className="h-[8px]" />
        <p className="m-0 w-[340px] text-center text-[14px] leading-[1.55] text-ink-2">
          {n} stops answering in every channel and its loops are paused. Its jobs, files and memory are kept, so its
          history stays in Analytics.
        </p>
        <div className="flex w-full gap-[8px] pt-[20px]">
          <Btn h={40} radius={12} fs={14} labelClass="font-semibold" className="min-w-0 flex-1" onClick={onClose}>
            Keep {n}
          </Btn>
          <Btn
            variant="danger-solid"
            icon={UserMinus}
            h={40}
            radius={12}
            fs={14}
            labelClass="font-semibold"
            className="min-w-0 flex-1"
            onClick={handleLetGo}
          >
            Let go
          </Btn>
        </div>
      </div>
    </div>,
    document.body,
  )
}

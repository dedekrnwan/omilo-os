import { useEffect } from 'react'
import { create } from 'zustand'
import { CircleCheck, X } from 'lucide-react'

interface ToastItem {
  id: number
  title: string
  undo?: () => void
}

interface ToastState {
  toasts: ToastItem[]
  push(t: Omit<ToastItem, 'id'>): void
  dismiss(id: number): void
}

let seq = 0
export const useToasts = create<ToastState>((set) => ({
  toasts: [],
  push: (t) => set((s) => ({ toasts: [...s.toasts.slice(-2), { ...t, id: ++seq }] })),
  dismiss: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
}))

/** Small confirmation for menu actions ("Link copied", "Chat archived · Undo"). */
export function notify(title: string, undo?: () => void) {
  useToasts.getState().push({ title, undo })
}

function ToastRow({ t }: { t: ToastItem }) {
  const dismiss = useToasts((s) => s.dismiss)
  useEffect(() => {
    const timer = setTimeout(() => dismiss(t.id), t.undo ? 6000 : 3000)
    return () => clearTimeout(timer)
  }, [t, dismiss])
  return (
    <div
      role="status"
      className="pointer-events-auto flex h-[40px] items-center gap-[9px] rounded-lg bg-primary pr-[6px] pl-[12px] text-[13px] text-primary-ink shadow-[0_10px_24px_#0C0A0940] animate-in fade-in-0 slide-in-from-bottom-2"
    >
      <CircleCheck size={15} aria-hidden className="shrink-0 text-[#86EFAC]" />
      <span className="whitespace-nowrap">{t.title}</span>
      {t.undo && (
        <button
          type="button"
          onClick={() => {
            t.undo?.()
            dismiss(t.id)
          }}
          className="ml-[4px] h-[26px] rounded-sm px-[8px] text-[12.5px] font-medium text-white hover:bg-[#FFFFFF1F]"
        >
          Undo
        </button>
      )}
      <button type="button" aria-label="Dismiss" onClick={() => dismiss(t.id)} className="flex size-[26px] items-center justify-center rounded-sm text-on-ink-2 hover:bg-[#FFFFFF1F]">
        <X size={13} aria-hidden />
      </button>
    </div>
  )
}

export function Toaster() {
  const toasts = useToasts((s) => s.toasts)
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none fixed bottom-[20px] left-1/2 z-[70] flex -translate-x-1/2 flex-col items-center gap-[8px]">
      {toasts.map((t) => (
        <ToastRow key={t.id} t={t} />
      ))}
    </div>
  )
}

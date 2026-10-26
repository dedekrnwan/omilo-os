/**
 * Shared styling for Radix-Dialog-based right drawers. All app "dialogs" render
 * as right-anchored, full-height drawers that slide in from the right. Swap a
 * centered Dialog.Content for these classes (keep width via style) to convert it.
 */

/** Scrim overlay (fade in/out). */
export const drawerOverlayClass =
  'fixed inset-0 z-50 bg-[#0C0A0940] backdrop-blur-[2px] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0'

/**
 * Right-anchored, full-height drawer content (slide in/out from the right).
 * Apply width via `style={{ width }}`; it is capped to the viewport.
 */
export const drawerContentClass =
  'fixed inset-y-0 right-0 z-50 flex h-full max-w-[calc(100vw-32px)] flex-col overflow-hidden bg-surface shadow-[-24px_0_48px_#0C0A0929] outline-1 -outline-offset-1 outline-line-strong duration-200 ease-soft data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:slide-out-to-right-8 data-[state=open]:slide-in-from-right-8'

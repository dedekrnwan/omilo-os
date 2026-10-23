import '@testing-library/jest-dom/vitest'

// Silence jsdom "not implemented" noise for scroll APIs
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true })
if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {}
}

// Enable React's act() in test environment
// @ts-expect-error — global flag recognised by React DOM
globalThis.IS_REACT_ACT_ENVIRONMENT = true

// Suppress known spurious console.error/console.warn noise from test helpers and
// React internals. These are NOT real errors — tests pass and behaviour is correct;
// these are timing artefacts from async router/query state and expected
// error-boundary catches.
const _origError = console.error.bind(console)
const _origWarn = console.warn.bind(console)

function shouldSuppress(...args: unknown[]): boolean {
  const msg = typeof args[0] === 'string' ? args[0] : ''
  // React act() timing warning — fires when router/query updates settle after act()
  if (msg.includes('not configured to support act(')) return true
  // React error boundary informational log — fires for intentional notFound() throws
  if (msg.includes('The above error occurred in the')) return true
  if (msg.includes('React will try to recreate this component tree')) return true
  if (msg.includes('CatchBoundary')) return true
  // TanStack Router notFound object logged when error boundaries catch notFound()
  // The object may appear as first arg or stringified in later args
  for (const arg of args) {
    if (arg !== null && typeof arg === 'object' && 'isNotFound' in (arg as object)) return true
    if (typeof arg === 'string' && arg.includes('isNotFound')) return true
  }
  return false
}

console.error = (...args: unknown[]) => {
  if (shouldSuppress(...args)) return
  _origError(...args)
}

console.warn = (...args: unknown[]) => {
  if (shouldSuppress(...args)) return
  _origWarn(...args)
}

import '@testing-library/jest-dom/vitest'

// Silence jsdom "not implemented" noise for scroll APIs
Object.defineProperty(window, 'scrollTo', { value: () => {}, writable: true })
if (!HTMLElement.prototype.scrollTo) {
  HTMLElement.prototype.scrollTo = () => {}
}

// Enable React's act() in test environment
// @ts-expect-error — global flag recognised by React DOM
globalThis.IS_REACT_ACT_ENVIRONMENT = true

/**
 * Control Panel route wiring guide.
 *
 * Add to src/app/router.tsx:
 *
 *   import { ControlPanelRoute } from '../features/control-panel/ControlPanelRoute'
 *
 *   const controlPanelRoute = createRoute({
 *     getParentRoute: () => rootRoute,
 *     path: '/control-panel',
 *     component: ControlPanelRoute,
 *   })
 *   const controlPanelSectionRoute = createRoute({
 *     getParentRoute: () => controlPanelRoute,
 *     path: '$section',
 *     component: ControlPanelRoute,
 *   })
 *
 *   // Add to routeTree:
 *   controlPanelRoute.addChildren([controlPanelSectionRoute]),
 *
 * Wire gear button in Rail.tsx TrayButton for settings:
 *   onClick={() => void navigate({ to: '/control-panel' })}
 *   current={currentPage === 'settings'}
 */

export const CONTROL_PANEL_PATH = '/control-panel' as const
export const CONTROL_PANEL_SECTION_PATH = '/control-panel/$section' as const
export type { ControlPanelSection } from './types'

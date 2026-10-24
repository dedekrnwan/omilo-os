/**
 * Team route definitions — import these into src/app/router.tsx to wire /team.
 *
 * Usage in router.tsx:
 *
 *   import { TeamLayout }  from '../features/team/TeamLayout'
 *   import { TeamRoster }  from '../features/team/TeamRoster'
 *   import { HelperDetail } from '../features/team/HelperDetail'
 *
 *   const teamRoute = createRoute({ getParentRoute: () => rootRoute, path: '/team', component: TeamLayout })
 *   const teamIndexRoute = createRoute({ getParentRoute: () => teamRoute, path: '/', component: TeamRoster })
 *   const teamHelperRoute = createRoute({ getParentRoute: () => teamRoute, path: '$helperId', component: HelperDetail })
 *
 *   // Add to routeTree:
 *   teamRoute.addChildren([teamIndexRoute, teamHelperRoute])
 *
 * Rail wiring: in src/ui/Rail.tsx, add navigate to '/team' on the Team TrayButton onClick.
 */

export type { } // keep as a module

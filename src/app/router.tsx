import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { Shell } from './Shell'
import { useUIStore, MODE_HOME } from './store'
import { ModeLayout } from '../features/shell/ModeLayout'
import { ChatIndexRoute, ChatSessionRoute } from '../features/chat/ChatRoute'
import { OfficeGoalsRoute as GoalsRoute } from '../features/goals/GoalsRoute'
import { ArchivedRoute } from '../features/chat/ArchivedRoute'
import { FolderRoute } from '../features/chat/FolderRoute'
import { InboxRoute } from '../features/office/InboxRoute'
import {
  OfficeFlowsRoute as FlowsRoute,
  OfficeFlowCanvasRoute as FlowCanvasRoute,
  OfficeFlowDraftRoute as FlowDraftRoute,
  OfficeFlowRunsRoute as FlowRunsRoute,
  OfficeFlowSettingsRoute as FlowSettingsRoute,
} from '../features/office/flows'
import { OfficeDocsRoute as DocsRoute } from '../features/office/docs/OfficeDocsRoute'
import { TeamLayout } from '../features/team/TeamLayout'
import { TeamRoster } from '../features/team/TeamRoster'
import { HelperDetail } from '../features/team/HelperDetail'
import { ControlPanelRoute } from '../features/control-panel/ControlPanelRoute'
import { NotificationsRoute } from '../features/notifications/NotificationsRoute'
import {
  SignInPage,
  GoogleNotAllowedPage,
  SignUpPage,
  ConfirmEmailPage,
  CreateCompanyPage,
  ChoosePlanPage,
  PaymentPage,
  AllSetPage,
  ForgotPasswordPage,
  ResetLinkSentPage,
  SetNewPasswordPage,
  PasswordUpdatedPage,
  ResetLinkExpiredPage,
  CheckEmailPage,
  TwoStepVerificationPage,
  ChooseCompanyPage,
  AcceptInvitePage,
  GoogleCallbackPage,
} from '../features/auth'
import { OnboardingRoute } from '../features/onboarding'
import { OfficeAnalyticsRoute as AnalyticsRoute } from '../features/analytics'
import { RoutinesRoute, RoutineDetailRoute } from '../features/routines'

/**
 * Root route renders a bare <Outlet /> (no Shell). Children:
 *   - the SHELL LAYOUT route (component: Shell) carries the Rail + global mounts
 *     and holds every in-app route.
 *   - STANDALONE routes (auth, onboarding) hang directly off root so they render
 *     full-screen with no Rail / Shell.
 */
const rootRoute = createRootRoute({
  component: () => <Outlet />,
  notFoundComponent: () => (
    <div
      role="alert"
      style={{ padding: 32, color: 'var(--muted)', fontFamily: 'var(--font-sans, sans-serif)' }}
    >
      Not found
    </div>
  ),
})

/**
 * Shell layout route: an id-based layout (no path segment) whose component is
 * the Shell. All in-app routes descend from here so they share the Rail,
 * CommandMenu and ChiefDm.
 */
const shellRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'shell',
  component: Shell,
})

/**
 * Root index: "/" redirects to the persisted mode's home. Mode is client state,
 * not a URL segment, so the redirect reads it from the store (hydrated from
 * localStorage before the router runs).
 */
const rootIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: MODE_HOME[useUIStore.getState().mode] })
  },
})

/**
 * App layout — the shared sidebar shell. A pathless layout route (no path
 * segment) that renders ModeLayout (AppSidebar + <Inset><Outlet/></Inset>).
 * ModeLayout reads `mode` from the store, so EVERY route below is mode-neutral:
 * one registration each, no /chat vs /office duplication. The only
 * mode-specific URLs are the two primaries — /chat (Chats) and /inbox (Inbox).
 */
const appLayoutRoute = createRoute({
  getParentRoute: () => shellRoute,
  id: 'app',
  component: () => <ModeLayout />,
})

// ── Primaries (the only mode-flavoured surfaces) ──────────────────────────────

/** Chat primary — the new-chat hero. */
const chatIndexRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/chat',
  component: ChatIndexRoute,
})

/** A chat session thread. Mode-neutral: the surrounding chrome follows the store. */
const chatSessionRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/chat/$sessionId',
  component: ChatSessionRoute,
})

/** Office primary — the inbox list. */
const inboxRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/inbox',
  component: InboxRoute,
})

/** Inbox item — same component reads $itemId. */
const inboxItemRoute = createRoute({
  getParentRoute: () => inboxRoute,
  path: '$itemId',
  component: InboxRoute,
})

// ── Shared, mode-neutral surfaces ─────────────────────────────────────────────

const archivedRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/archived',
  component: ArchivedRoute,
})

const folderRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/folder/$folderId',
  component: FolderRoute,
})

const goalsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/goals',
  component: GoalsRoute,
})

const flowsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/flows',
  component: FlowsRoute,
})

const routinesRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/routines',
  component: RoutinesRoute,
})

const routineDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/routines/$routineId',
  component: RoutineDetailRoute,
})

const docsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/docs',
  component: DocsRoute,
})

// ── sweep/docs ── /docs/$docId opens a doc from a copied link (/docs/handbook → handbook)
const docDetailRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/docs/$docId',
  component: DocsRoute,
})

const analyticsRoute = createRoute({
  getParentRoute: () => appLayoutRoute,
  path: '/analytics',
  component: AnalyticsRoute,
})

/**
 * Editor layout — a SEPARATE pathless layout that renders only <Outlet /> (no
 * sidebar). The flow editor is a full-screen, mode-neutral surface: the step
 * palette is its sidebar. Lives beside appLayout, so /flows (board, in the
 * sidebar shell) and /flows/$flowId/canvas (full-screen editor) are distinct
 * full paths in two different layout branches — no collision, no sidebar on the
 * editor.
 */
const editorLayoutRoute = createRoute({
  getParentRoute: () => shellRoute,
  id: 'editor',
  component: () => <Outlet />,
})

const flowCanvasRoute = createRoute({
  getParentRoute: () => editorLayoutRoute,
  path: '/flows/$flowId/canvas',
  component: FlowCanvasRoute,
})

const flowDraftRoute = createRoute({
  getParentRoute: () => editorLayoutRoute,
  path: '/flows/$flowId/draft',
  component: FlowDraftRoute,
})

const flowRunsRoute = createRoute({
  getParentRoute: () => editorLayoutRoute,
  path: '/flows/$flowId/runs',
  component: FlowRunsRoute,
})

const flowSettingsRoute = createRoute({
  getParentRoute: () => editorLayoutRoute,
  path: '/flows/$flowId/settings',
  component: FlowSettingsRoute,
})

/**
 * Team routes — TeamLayout renders <Outlet /> (no sidebar); children render
 * their own Inset.
 */
const teamRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/team',
  component: TeamLayout,
})

const teamIndexRoute = createRoute({
  getParentRoute: () => teamRoute,
  path: '/',
  component: TeamRoster,
})

const teamHelperRoute = createRoute({
  getParentRoute: () => teamRoute,
  path: '$helperId',
  component: HelperDetail,
})

/**
 * Control panel — same component for the root and the $section child; the
 * component reads the section param (strict: false) and syncs it to the URL.
 */
const controlPanelRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/control-panel',
  component: ControlPanelRoute,
})

const controlPanelSectionRoute = createRoute({
  getParentRoute: () => controlPanelRoute,
  path: '$section',
  component: ControlPanelRoute,
})

/** Notifications page. */
const notificationsRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/notifications',
  component: NotificationsRoute,
})

// ── Standalone (no Shell) routes ──────────────────────────────────────────────

/** Auth screens — full-screen, mounted off the root (outside the Shell). */
const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/auth',
  component: () => <Outlet />,
})

const authSignInRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'sign-in',
  component: SignInPage,
})

const authGoogleNotAllowedRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'sign-in/google-not-allowed',
  component: GoogleNotAllowedPage,
})

const authSignUpRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'sign-up',
  component: SignUpPage,
})

const authConfirmEmailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'confirm-email',
  component: ConfirmEmailPage,
})

const authCreateCompanyRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'onboarding/company',
  component: CreateCompanyPage,
})

const authChoosePlanRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'onboarding/plan',
  component: ChoosePlanPage,
})

const authPaymentRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'onboarding/payment',
  component: PaymentPage,
})

const authAllSetRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'onboarding/all-set',
  component: AllSetPage,
})

const authForgotPasswordRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'forgot-password',
  component: ForgotPasswordPage,
})

const authResetLinkSentRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'forgot-password/sent',
  component: ResetLinkSentPage,
})

const authResetPasswordRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'reset-password',
  component: SetNewPasswordPage,
})

const authPasswordUpdatedRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'reset-password/success',
  component: PasswordUpdatedPage,
})

const authResetLinkExpiredRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'reset-password/expired',
  component: ResetLinkExpiredPage,
})

const authCheckEmailRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'check-email',
  component: CheckEmailPage,
})

const authTwoStepRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'two-step',
  component: TwoStepVerificationPage,
})

const authChooseCompanyRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'choose-company',
  component: ChooseCompanyPage,
})

const authInviteRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'invite',
  component: AcceptInvitePage,
})

/**
 * Google OAuth callback — /auth/callback
 * Unguarded: receives #token= from the backend redirect and bootstraps the session.
 */
const authGoogleCallbackRoute = createRoute({
  getParentRoute: () => authRoute,
  path: 'callback',
  component: GoogleCallbackPage,
})

/** Onboarding wizard — full-screen, mounted off the root (outside the Shell). */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingRoute,
})

const routeTree = rootRoute.addChildren([
  rootIndexRoute,
  shellRoute.addChildren([
    appLayoutRoute.addChildren([
      chatIndexRoute,
      chatSessionRoute,
      inboxRoute.addChildren([inboxItemRoute]),
      archivedRoute,
      folderRoute,
      goalsRoute,
      flowsRoute,
      routinesRoute,
      routineDetailRoute,
      docsRoute,
      docDetailRoute,
      analyticsRoute,
    ]),
    editorLayoutRoute.addChildren([
      flowCanvasRoute,
      flowDraftRoute,
      flowRunsRoute,
      flowSettingsRoute,
    ]),
    teamRoute.addChildren([teamIndexRoute, teamHelperRoute]),
    controlPanelRoute.addChildren([controlPanelSectionRoute]),
    notificationsRoute,
  ]),
  authRoute.addChildren([
    authSignInRoute,
    authGoogleNotAllowedRoute,
    authSignUpRoute,
    authConfirmEmailRoute,
    authCreateCompanyRoute,
    authChoosePlanRoute,
    authPaymentRoute,
    authAllSetRoute,
    authForgotPasswordRoute,
    authResetLinkSentRoute,
    authResetPasswordRoute,
    authPasswordUpdatedRoute,
    authResetLinkExpiredRoute,
    authCheckEmailRoute,
    authTwoStepRoute,
    authChooseCompanyRoute,
    authInviteRoute,
    authGoogleCallbackRoute,
  ]),
  onboardingRoute,
])

export const router = createRouter({
  routeTree,
  history: createBrowserHistory(),
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}

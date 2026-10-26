import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

import { Shell } from './Shell'
import { ModeLayout } from '../features/shell/ModeLayout'
import { ChatIndexRoute, ChatSessionRoute } from '../features/chat/ChatRoute'
import { ChatGoalsRoute, OfficeGoalsRoute } from '../features/goals/GoalsRoute'
import { DocsRoute } from '../features/chat/DocsRoute'
import { ArchivedRoute } from '../features/chat/ArchivedRoute'
import { FolderRoute } from '../features/chat/FolderRoute'
import { InboxRoute } from '../features/office/InboxRoute'
import {
  OfficeFlowsRoute,
  ChatFlowsRoute,
  OfficeFlowCanvasRoute,
  OfficeFlowDraftRoute,
  OfficeFlowRunsRoute,
} from '../features/office/flows'
import { OfficeDocsRoute } from '../features/office/docs/OfficeDocsRoute'
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
} from '../features/auth'
import { OnboardingRoute } from '../features/onboarding'
import { ChatAnalyticsRoute, OfficeAnalyticsRoute } from '../features/analytics'
import {
  RoutinesRoute,
  RoutineDetailRoute,
  ChatRoutinesRoute,
  ChatRoutineDetailRoute,
} from '../features/routines'

/**
 * Root route renders a bare <Outlet /> (no Shell). Two kinds of children hang
 * off it:
 *   - the SHELL LAYOUT route (component: Shell) carries the Rail + global mounts
 *     and holds every in-app route (chat, office, team, control-panel,
 *     notifications).
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

/** Root index: "/" redirects to the chat new-chat view. */
const rootIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat' })
  },
})

/**
 * Chat routes — /chat is the ModeLayout(chat) shell (unified sidebar + Inset).
 * No channel segment: the selected Area lives in the UI store and filters pages.
 *
 * /chat              (index) → ChatIndexRoute  (new-chat hero)
 * /chat/$sessionId           → ChatSessionRoute (session thread)
 * /chat/goals|flows|docs|analytics|archived|routines
 * /chat/folder/$folderId
 */
const chatRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/chat',
  component: () => <ModeLayout mode="chat" />,
})

const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  component: ChatIndexRoute,
})

/** Session route: /chat/$sessionId → session thread (static siblings win, so reserved words are safe). */
const chatSessionRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$sessionId',
  component: ChatSessionRoute,
})

const chatGoalsRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'goals',
  component: ChatGoalsRoute,
})

const chatFlowsRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'flows',
  component: ChatFlowsRoute,
})

const chatDocsRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'docs',
  component: DocsRoute,
})

const chatArchivedRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'archived',
  component: ArchivedRoute,
})

const chatAnalyticsRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'analytics',
  component: ChatAnalyticsRoute,
})

const chatFolderRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'folder/$folderId',
  component: FolderRoute,
})

const chatRoutinesRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'routines',
  component: ChatRoutinesRoute,
})

const chatRoutineDetailRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: 'routines/$routineId',
  component: ChatRoutineDetailRoute,
})

/**
 * Office routes — OfficeLayout renders the sidebar once; child routes render
 * main content only (no sidebar duplication).
 *
 * /office                            → layout passthrough
 * /office/inbox          (index)     → InboxRoute (inbox list)
 * /office/inbox/$itemId              → InboxRoute (inbox item → ChatSession)
 * /office/goals                      → OfficeGoalsRoute (company-wide goals)
 * /office/flows                      → OfficeFlowsRoute (+ canvas / draft / runs)
 * /office/docs                       → OfficeDocsRoute
 */
const officeRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/office',
  component: () => <ModeLayout mode="office" />,
})

const officeInboxRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'inbox',
  component: InboxRoute,
})

/** Office chat thread — opens a session in the office shell (stays in office mode). */
const officeChatSessionRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'chat/$sessionId',
  component: ChatSessionRoute,
})

/** Office folder view — reuses the chat folder page within the office shell. */
const officeFolderRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'folder/$folderId',
  component: FolderRoute,
})

const officeInboxItemRoute = createRoute({
  getParentRoute: () => officeInboxRoute,
  path: '$itemId',
  component: InboxRoute,
})

const officeGoalsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'goals',
  component: OfficeGoalsRoute,
})

const officeFlowsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'flows',
  component: OfficeFlowsRoute,
})

const officeFlowCanvasRoute = createRoute({
  getParentRoute: () => officeFlowsRoute,
  path: '$flowId/canvas',
  component: OfficeFlowCanvasRoute,
})

const officeFlowDraftRoute = createRoute({
  getParentRoute: () => officeFlowsRoute,
  path: '$flowId/draft',
  component: OfficeFlowDraftRoute,
})

const officeFlowRunsRoute = createRoute({
  getParentRoute: () => officeFlowsRoute,
  path: '$flowId/runs',
  component: OfficeFlowRunsRoute,
})

const officeRoutinesRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'routines',
  component: RoutinesRoute,
})

const officeRoutineDetailRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'routines/$routineId',
  component: RoutineDetailRoute,
})

const officeAnalyticsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'analytics',
  component: OfficeAnalyticsRoute,
})

const officeDocsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'docs',
  component: OfficeDocsRoute,
})

/**
 * Team routes — TeamLayout renders <Outlet /> (no sidebar); children render
 * their own Inset.
 *
 * /team                  (index) → TeamRoster
 * /team/$helperId                → HelperDetail
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

/** Onboarding wizard — full-screen, mounted off the root (outside the Shell). */
const onboardingRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/onboarding',
  component: OnboardingRoute,
})

const routeTree = rootRoute.addChildren([
  rootIndexRoute,
  shellRoute.addChildren([
    chatRoute.addChildren([
      chatIndexRoute,
      chatSessionRoute,
      chatGoalsRoute,
      chatFlowsRoute,
      chatDocsRoute,
      chatArchivedRoute,
      chatFolderRoute,
      chatAnalyticsRoute,
      chatRoutinesRoute,
      chatRoutineDetailRoute,
    ]),
    officeRoute.addChildren([
      officeInboxRoute.addChildren([officeInboxItemRoute]),
      officeChatSessionRoute,
      officeFolderRoute,
      officeGoalsRoute,
      officeFlowsRoute.addChildren([
        officeFlowCanvasRoute,
        officeFlowDraftRoute,
        officeFlowRunsRoute,
      ]),
      officeDocsRoute,
      officeRoutinesRoute,
      officeRoutineDetailRoute,
      officeAnalyticsRoute,
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

import {
  createBrowserHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  redirect,
} from '@tanstack/react-router'

/** Default landing: the General channel's new-chat hero. */
const DEFAULT_CHANNEL = 'ch-general'
import { Shell } from './Shell'
import { ChatChannelLayout } from '../features/chat/ChatChannelLayout'
import { ChatIndexRoute, ChatSessionRoute } from '../features/chat/ChatRoute'
import { GoalsRoute } from '../features/chat/GoalsRoute'
import { FlowsRoute } from '../features/chat/FlowsRoute'
import { DocsRoute } from '../features/chat/DocsRoute'
import { ArchivedRoute } from '../features/chat/ArchivedRoute'
import { FolderRoute } from '../features/chat/FolderRoute'
import { InboxRoute } from '../features/office/InboxRoute'
import { OfficeLayout } from '../features/office/OfficeLayout'
import { OfficeGoalsRoute } from '../features/office/OfficeGoalsRoute'
import {
  OfficeFlowsRoute,
  OfficeFlowCanvasRoute,
  OfficeFlowDraftRoute,
  OfficeFlowRunsRoute,
} from '../features/office/flows'
import { OfficeDocsRoute } from '../features/office/docs/OfficeDocsRoute'
import { ChatAnalyticsRoute, OfficeAnalyticsRoute } from '../features/analytics'
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

/** Root index: "/" redirects to the default channel's new-chat view. */
const rootIndexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat/$channelId', params: { channelId: DEFAULT_CHANNEL } })
  },
})

/**
 * Chat routes — layout-based nesting so the ChannelSidebar renders ONCE
 * and each child route swaps main content via <Outlet />.
 *
 * /chat                              → passthrough (redirects to default channel)
 * /chat/$channelId                   → ChatChannelLayout (sidebar + Inset(<Outlet />))
 * /chat/$channelId/          (index) → ChatIndexRoute  (new-chat hero)
 * /chat/$channelId/$sessionId        → ChatSessionRoute (session thread)
 * /chat/$channelId/goals             → GoalsRoute
 * /chat/$channelId/flows             → FlowsRoute
 * /chat/$channelId/docs              → DocsRoute
 */
const chatRoute = createRoute({
  getParentRoute: () => shellRoute,
  path: '/chat',
  component: () => <Outlet />,
})

/** Bare /chat redirects to the default channel. */
const chatIndexRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat/$channelId', params: { channelId: DEFAULT_CHANNEL } })
  },
})

const chatChannelRoute = createRoute({
  getParentRoute: () => chatRoute,
  path: '$channelId',
  component: ChatChannelLayout,
})

/** Index route: /chat/$channelId → new-chat hero */
const chatChannelIndexRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: '/',
  component: ChatIndexRoute,
})

/** Session route: /chat/$channelId/$sessionId → session thread */
const chatSessionRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: '$sessionId',
  component: ChatSessionRoute,
})

const chatGoalsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'goals',
  component: GoalsRoute,
})

const chatFlowsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'flows',
  component: FlowsRoute,
})

const chatDocsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'docs',
  component: DocsRoute,
})

const chatAnalyticsRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'analytics',
  component: ChatAnalyticsRoute,
})

const chatArchivedRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'archived',
  component: ArchivedRoute,
})

const chatFolderRoute = createRoute({
  getParentRoute: () => chatChannelRoute,
  path: 'folder/$folderId',
  component: FolderRoute,
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
  component: OfficeLayout,
})

const officeInboxRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'inbox',
  component: InboxRoute,
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

const officeDocsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'docs',
  component: OfficeDocsRoute,
})

const officeAnalyticsRoute = createRoute({
  getParentRoute: () => officeRoute,
  path: 'analytics',
  component: OfficeAnalyticsRoute,
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
      chatChannelRoute.addChildren([
        chatChannelIndexRoute,
        chatSessionRoute,
        chatGoalsRoute,
        chatFlowsRoute,
        chatDocsRoute,
        chatAnalyticsRoute,
        chatArchivedRoute,
        chatFolderRoute,
      ]),
    ]),
    officeRoute.addChildren([
      officeInboxRoute.addChildren([officeInboxItemRoute]),
      officeGoalsRoute,
      officeFlowsRoute.addChildren([
        officeFlowCanvasRoute,
        officeFlowDraftRoute,
        officeFlowRunsRoute,
      ]),
      officeDocsRoute,
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

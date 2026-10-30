import type {
  AiAccount,
  AnalyticsOverview,
  BillingPlan,
  BillingSubscription,
  Channel,
  CompanyMember,
  Connector,
  Flow,
  FlowRun,
  Folder,
  Goal,
  Helper,
  HelperStat,
  KbItem,
  KbSource,
  McpToken,
  Message,
  Piece,
  Routine,
  Session,
  Skill,
  InboxItem,
  UsageSummary,
  WalletSettings,
} from '../../core/domain/types'

// Mock data mirrors the content of omilo-v2.pen (Chat · New chat, Chat · Session,
// Office · Inbox) so the running app reads exactly like the design.

// ── Billing Plans ─────────────────────────────────────────────────────────────

/** Filled below with the Cloud tiers (Starter / Team / Business). */
export const billingPlans: BillingPlan[] = []

export const billingSubscription: BillingSubscription = {
  planId: 'plan_team',
  status: 'trialing',
  currentPeriodEnd: '2026-11-11T00:00:00Z',
  seats: 5,
  billingInterval: 'yearly',
  isTrial: true,
  trialEndsAt: '2026-11-11T00:00:00Z',
  trialDaysLeft: 14,
}

// ── Channels ─────────────────────────────────────────────────────────────────

export const channels: Channel[] = [
  { id: 'ch-general',     name: 'General',     accent: 'general',   isDefault: true, agentCount: 0, chatCount: 31, openItems: 2, contextScope: 'isolated' },
  { id: 'ch-engineering', name: 'Engineering', accent: 'dev',       agentCount: 3, chatCount: 24, openItems: 5, contextScope: 'isolated' },
  { id: 'ch-marketing',   name: 'Marketing',   accent: 'marketing', agentCount: 2, chatCount: 18, openItems: 4, contextScope: 'isolated' },
  { id: 'ch-business',    name: 'Business',    accent: 'sales',     agentCount: 2, chatCount: 9, openItems: 3, contextScope: 'isolated' },
]

// ── Goals (hero "Or start from a goal" + sidebar Goals count) ───────────────

export const goals: Goal[] = [
  { id: 'g-books',     channelId: 'ch-general', title: 'Close October books',     progress: 70 },
  { id: 'g-referral',  channelId: 'ch-general', title: 'Launch referral program', progress: 35 },
  { id: 'g-offsite',   channelId: 'ch-general', title: 'Plan Q1 offsite',         progress: 10 },

  { id: 'g-passkeys',  channelId: 'ch-engineering', title: 'Passwordless login by Q4', progress: 40 },
  { id: 'g-pg16',      channelId: 'ch-engineering', title: 'Postgres 16 upgrade',      progress: 55 },
  { id: 'g-ci',        channelId: 'ch-engineering', title: 'CI under 10 minutes',      progress: 20 },
  { id: 'g-uptime',    channelId: 'ch-engineering', title: '99.95% API uptime',        progress: 80 },

  { id: 'g-ref-launch', channelId: 'ch-marketing', title: 'Referral launch',      progress: 35 },
  { id: 'g-content',    channelId: 'ch-marketing', title: 'November content plan', progress: 60 },

  { id: 'g-pilot',     channelId: 'ch-business', title: 'Close Arunika pilot', progress: 50 },
]

// ── Folders ──────────────────────────────────────────────────────────────────

export const folders: Folder[] = [
  { id: 'f-offsite',   channelId: 'ch-general', name: 'Company offsite', count: 4 },
  { id: 'f-board',     channelId: 'ch-general', name: 'Board prep',      count: 3 },
  { id: 'f-ideas',     channelId: 'ch-general', name: 'Ideas',           count: 2 },

  { id: 'f-q4',        channelId: 'ch-engineering', name: 'Q4 Launch',        count: 6 },
  { id: 'f-infra',     channelId: 'ch-engineering', name: 'Infra migration',  count: 3 },
  { id: 'f-incidents', channelId: 'ch-engineering', name: 'Incident reviews', count: 2 },

  { id: 'f-referral',  channelId: 'ch-marketing', name: 'Referral launch', count: 3 },
  { id: 'f-brand',     channelId: 'ch-marketing', name: 'Brand refresh',   count: 2 },

  { id: 'f-pilots',    channelId: 'ch-business', name: 'Pilots',    count: 2 },
  { id: 'f-pricing',   channelId: 'ch-business', name: 'Pricing',   count: 1 },
]

// ── Sessions ─────────────────────────────────────────────────────────────────

const chiefAndDev = [
  { name: 'Chief', area: 'brand' as const },
  { name: 'Dev',   area: 'dev' as const },
]

export const sessions: Session[] = [
  // General — Recent
  { id: 'sess-investor',  channelId: 'ch-general', title: 'October investor update',   updated: 'now' },
  { id: 'sess-vendors',   channelId: 'ch-general', title: 'Vendor renewals owner?',    updated: '1h', unread: true },
  { id: 'sess-weekly',    channelId: 'ch-general', title: 'Weekly cross-area summary', updated: '3h' },
  { id: 'sess-holiday',   channelId: 'ch-general', title: 'Holiday schedule FAQ',      updated: 'Yesterday' },
  { id: 'sess-venue',     channelId: 'ch-general', title: 'Offsite venue shortlist',   updated: 'Mon' },
  { id: 'sess-welcome',   channelId: 'ch-general', title: 'New hire welcome note',     updated: 'Oct 18' },
  // General — folders
  { id: 'sess-offsite-1', channelId: 'ch-general', folderId: 'f-offsite', title: 'Offsite agenda draft',   updated: '2d' },
  { id: 'sess-offsite-2', channelId: 'ch-general', folderId: 'f-offsite', title: 'Travel budget per head', updated: '3d' },
  { id: 'sess-board-1',   channelId: 'ch-general', folderId: 'f-board',   title: 'Q3 board deck outline',  updated: '1w' },
  { id: 'sess-ideas-1',   channelId: 'ch-general', folderId: 'f-ideas',   title: 'Loyalty program idea',   updated: '2w' },

  // Engineering — Q4 Launch folder
  {
    id: 'sess-passkey', channelId: 'ch-engineering', folderId: 'f-q4',
    title: 'Passkey rollout plan', updated: 'now',
    goal: 'Passwordless login by Q4', participants: chiefAndDev,
  },
  { id: 'sess-launch-comms', channelId: 'ch-engineering', folderId: 'f-q4', title: 'Launch day comms',         updated: '2h', participants: chiefAndDev },
  { id: 'sess-freeze',       channelId: 'ch-engineering', folderId: 'f-q4', title: 'Freeze exceptions policy', updated: '1d', participants: chiefAndDev },
  { id: 'sess-q4-4',         channelId: 'ch-engineering', folderId: 'f-q4', title: 'Staging smoke tests',      updated: '2d' },
  { id: 'sess-q4-5',         channelId: 'ch-engineering', folderId: 'f-q4', title: 'Feature flag cleanup',     updated: '3d' },
  { id: 'sess-q4-6',         channelId: 'ch-engineering', folderId: 'f-q4', title: 'Release notes draft',      updated: '4d' },
  // Engineering — other folders
  { id: 'sess-infra-1',    channelId: 'ch-engineering', folderId: 'f-infra',     title: 'Move workers to Fargate', updated: '2d' },
  { id: 'sess-incident-1', channelId: 'ch-engineering', folderId: 'f-incidents', title: 'Checkout 429 storm',      updated: '3d' },
  // Engineering — Recent
  { id: 'sess-flaky',     channelId: 'ch-engineering', title: 'Flaky e2e tests on CI',          updated: 'now' },
  { id: 'sess-deploy',    channelId: 'ch-engineering', title: 'Why did deploy #482 fail?',      updated: '1h', unread: true },
  { id: 'sess-pg16',      channelId: 'ch-engineering', title: 'Postgres 16 upgrade checklist',  updated: '3h' },
  { id: 'sess-retro',     channelId: 'ch-engineering', title: 'Sprint 42 retro notes',          updated: 'Yesterday' },
  { id: 'sess-oncall',    channelId: 'ch-engineering', title: 'On-call handover template',      updated: 'Mon' },
  { id: 'sess-ratelimit', channelId: 'ch-engineering', title: 'Rate limiter design review',     updated: 'Oct 18' },

  // Marketing
  { id: 'sess-ad-budget', channelId: 'ch-marketing', folderId: 'f-referral', title: 'Referral launch budget', updated: '25m' },
  { id: 'sess-ref-copy',  channelId: 'ch-marketing', folderId: 'f-referral', title: 'Referral email copy',    updated: '1d' },
  { id: 'sess-brand-1',   channelId: 'ch-marketing', folderId: 'f-brand',    title: 'Logo refresh brief',     updated: '1w' },
  { id: 'sess-campaign',  channelId: 'ch-marketing', title: 'Campaign launch debrief', updated: '2h' },
  { id: 'sess-calendar',  channelId: 'ch-marketing', title: 'Content calendar review', updated: 'Yesterday' },

  // Business
  { id: 'sess-arunika',   channelId: 'ch-business', folderId: 'f-pilots',  title: 'Pilot contract redlines', updated: '1h', unread: true },
  { id: 'sess-pricing',   channelId: 'ch-business', folderId: 'f-pricing', title: 'Annual pricing tiers',    updated: '3d' },
  { id: 'sess-pipeline',  channelId: 'ch-business', title: 'Pipeline review',  updated: 'Mon' },
]

// ── Messages ──────────────────────────────────────────────────────────────────

const chief = { kind: 'helper' as const, name: 'Chief', role: 'Chief of Staff', area: 'brand' as const }
const dev = { kind: 'helper' as const, name: 'Dev', role: 'Engineering agent', area: 'dev' as const }
const growth = { kind: 'helper' as const, name: 'Growth', role: 'Marketing agent', area: 'marketing' as const }
const you = { kind: 'you' as const, name: 'You' }

export const messages: Message[] = [
  // Passkey rollout plan — the "Chat · Session" design
  {
    id: 'msg-pk-1', sessionId: 'sess-passkey', author: you,
    content: 'Can we ship passkeys to everyone before the Q4 code freeze on Nov 28?',
    createdAt: '2026-10-22T10:40:00Z',
  },
  {
    id: 'msg-pk-2', sessionId: 'sess-passkey', author: chief,
    content: 'Yes — if we split it in two. Your Engineering goal “Passwordless login by Q4” is at 40%, and the blocker is WebAuthn on the legacy Android app. I’m pulling Dev in to size it.',
    createdAt: '2026-10-22T10:41:00Z',
  },
  {
    id: 'msg-pk-3', sessionId: 'sess-passkey', author: dev, system: true,
    content: 'Chief added Dev to this chat',
    createdAt: '2026-10-22T10:42:00Z',
  },
  {
    id: 'msg-pk-4', sessionId: 'sess-passkey', author: dev,
    content: 'Sized it. Web + iOS can ship Nov 14 (≈3 days). Legacy Android needs a password fallback flow, ≈5 days. Rollout doc is drafted in this channel’s Docs.',
    createdAt: '2026-10-22T10:43:00Z',
    attachment: { title: 'Passkey rollout — v1', meta: 'Doc · Engineering · edited just now' },
  },
  {
    id: 'msg-pk-5', sessionId: 'sess-passkey', author: chief,
    content: 'Want me to turn this into 3 tasks under the goal? They’ll show up in Office mode for tracking and approvals.',
    createdAt: '2026-10-22T10:44:00Z',
    actions: [{ label: 'Create 3 tasks in Goal', primary: true }, { label: 'Not yet' }],
  },

  // Launch day comms
  {
    id: 'msg-lc-1', sessionId: 'sess-launch-comms', author: you,
    content: 'Draft the launch-day announcement for passkeys.',
    createdAt: '2026-10-22T08:10:00Z',
  },
  {
    id: 'msg-lc-2', sessionId: 'sess-launch-comms', author: chief,
    content: 'Drafted a short in-app banner and an email. Growth will send them once web + iOS are live on Nov 14.',
    createdAt: '2026-10-22T08:12:00Z',
  },

  // Flaky e2e tests
  {
    id: 'msg-fl-1', sessionId: 'sess-flaky', author: you,
    content: 'Why are the checkout e2e tests flaky again?',
    createdAt: '2026-10-24T09:02:00Z',
  },
  {
    id: 'msg-fl-2', sessionId: 'sess-flaky', author: dev,
    content: 'Two tests wait on a fixed 2s timeout for the payment iframe. I’ll switch them to wait for the iframe’s ready event.',
    createdAt: '2026-10-24T09:03:00Z',
  },

  // October investor update (General)
  {
    id: 'msg-inv-1', sessionId: 'sess-investor', author: you,
    content: 'Start the October investor update.',
    createdAt: '2026-10-24T08:30:00Z',
  },
  {
    id: 'msg-inv-2', sessionId: 'sess-investor', author: chief,
    content: 'Here’s a first outline: revenue up 12% month over month, two goals moved, one hire closed. Want me to pull the numbers from Finance?',
    createdAt: '2026-10-24T08:31:00Z',
  },

  // Offsite venue shortlist (General)
  {
    id: 'msg-ven-1', sessionId: 'sess-venue', author: chief,
    content: 'I found 3 venues within budget for the Q1 offsite. Pick one and I’ll hold the date.',
    createdAt: '2026-10-23T16:00:00Z',
  },

  // Referral launch budget (Marketing)
  {
    id: 'msg-ad-1', sessionId: 'sess-ad-budget', author: growth,
    content: 'The referral test returned 3.1× on $600. I’d like a $4,800 cap over 14 days across Meta and TikTok.',
    createdAt: '2026-10-24T09:35:00Z',
  },

  // Campaign launch debrief (Marketing)
  {
    id: 'msg-cmp-1', sessionId: 'sess-campaign', author: you,
    content: 'The campaign wrapped up yesterday. What were the key numbers?',
    createdAt: '2026-10-24T09:00:00Z',
  },
  {
    id: 'msg-cmp-2', sessionId: 'sess-campaign', author: growth,
    content: 'Total reach: 240k impressions, 3.8% CTR, 12% conversion on the landing page — above our 9% target.',
    createdAt: '2026-10-24T09:01:00Z',
  },

  // Pilot contract redlines (Business)
  {
    id: 'msg-aru-1', sessionId: 'sess-arunika', author: { kind: 'helper', name: 'Sales', role: 'Sales agent', area: 'sales' },
    content: 'Arunika sent redlines on the pilot contract: a 60-day term instead of 90, and a data-export clause. Both look acceptable.',
    createdAt: '2026-10-24T08:40:00Z',
  },
]

// ── Usage ─────────────────────────────────────────────────────────────────────

export const usageSummary: UsageSummary = {
  balance: 4_200,
  included: 2_000,
  usedThisPeriod: 1_450,
  byHelper: [
    { helperId: 'h-chief',  credits: 820 },
    { helperId: 'h-dev',    credits: 430 },
    { helperId: 'h-growth', credits: 200 },
  ],
  byDay: [
    { day: '2026-10-01', credits: 180 },
    { day: '2026-10-08', credits: 260 },
    { day: '2026-10-15', credits: 510 },
    { day: '2026-10-22', credits: 500 },
  ],
  pendingTopups: { count: 0, totalCredits: 0 },
  lastPayment: null,
}

// ── Wallet ────────────────────────────────────────────────────────────────────

export const walletSettings: WalletSettings = {
  autoTopupEnabled: false,
  autoTopupThresholdCredits: 0,
  autoTopupPack: null,
}

// ── AI Accounts ───────────────────────────────────────────────────────────────

export const aiAccounts: AiAccount[] = [
  {
    id: 'acc-chief',
    harness: 'claude',
    name: 'Anthropic main',
    tag: 'primary',
    status: 'ready',
    pctWindow: 12,
    tokens: 'sk-ant-...****',
    lastUsed: '2026-10-24T09:00:00Z',
  },
  {
    id: 'acc-dev',
    harness: 'claude',
    name: 'Anthropic dev overflow',
    tag: 'overflow',
    status: 'ready',
    pctWindow: 4,
    tokens: 'sk-ant-...####',
    lastUsed: '2026-10-22T15:30:00Z',
  },
]

// ── Marketplace ───────────────────────────────────────────────────────────────

export const pieces: Piece[] = [
  {
    id: 'piece-slack',
    label: 'Slack',
    category: 'communication',
    description: 'Send messages and notifications to Slack channels and DMs.',
    authType: 'oauth2',
    actionCount: 14,
    logo: 'https://cdn.omilo.com/pieces/slack.svg',
    status: 'ok',
  },
  {
    id: 'piece-gmail',
    label: 'Gmail',
    category: 'communication',
    description: 'Send, search, and label emails from a Gmail account.',
    authType: 'oauth2',
    actionCount: 8,
    logo: 'https://cdn.omilo.com/pieces/gmail.svg',
    status: 'ok',
  },
  {
    id: 'piece-notion',
    label: 'Notion',
    category: 'productivity',
    description: 'Create and update Notion pages and databases.',
    authType: 'oauth2',
    actionCount: 10,
    logo: 'https://cdn.omilo.com/pieces/notion.svg',
    status: 'ok',
  },
  {
    id: 'piece-github',
    label: 'GitHub',
    category: 'developer',
    description: 'Open issues, create PRs, and check CI status in GitHub.',
    authType: 'oauth2',
    actionCount: 18,
    logo: 'https://cdn.omilo.com/pieces/github.svg',
    status: 'ok',
  },
]

// ── Connectors ────────────────────────────────────────────────────────────────

export const connectors: Connector[] = [
  {
    id: 'con-slack',
    pieceId: 'piece-slack',
    label: 'Slack',
    source: 'marketplace',
    status: 'connected',
    enabled: true,
  },
  {
    id: 'con-github',
    pieceId: 'piece-github',
    label: 'GitHub',
    source: 'marketplace',
    status: 'connected',
    enabled: true,
  },
]

// ── MCP Tokens ────────────────────────────────────────────────────────────────

export const mcpTokens: McpToken[] = [
  {
    id: 'mct-chief-cursor',
    label: 'Chief · Cursor',
    helperId: 'h-chief',
    scopes: ['mcp:read', 'mcp:write'],
    expiresAt: null,
    lastUsedAt: '2026-10-24T08:45:00Z',
    revokedAt: null,
    active: true,
  },
  {
    id: 'mct-dev-vscode',
    label: 'Dev · VS Code',
    helperId: 'h-dev',
    scopes: ['mcp:read'],
    expiresAt: '2027-01-01T00:00:00Z',
    lastUsedAt: '2026-10-23T16:00:00Z',
    revokedAt: null,
    active: true,
  },
]

// ── Flows ─────────────────────────────────────────────────────────────────────

export const flows: Flow[] = [
  {
    id: 'flw-morning-brief',
    title: 'Morning brief',
    status: 'active',
    enabled: true,
    count: 4,
    areas: ['general'],
    createdAt: '2026-10-01T08:00:00Z',
    trigger: { kind: 'schedule', spec: { cron: '0 7 * * *' } },
  },
  {
    id: 'flw-weekly-summary',
    title: 'Weekly cross-area summary',
    status: 'draft',
    enabled: false,
    count: 6,
    areas: ['general', 'engineering'],
    createdAt: '2026-10-10T10:00:00Z',
    trigger: { kind: 'schedule', spec: { cron: '0 9 * * 1' } },
  },
  {
    id: 'flw-incident-response',
    title: 'Incident response',
    status: 'draft',
    enabled: false,
    count: 8,
    areas: ['engineering'],
    createdAt: '2026-10-15T14:00:00Z',
    trigger: { kind: 'manual', spec: {} },
  },
]

export const flowRuns: FlowRun[] = [
  {
    id: 'frn-1',
    flowId: 'flw-morning-brief',
    status: 'done',
    triggerSummary: 'schedule',
    startedBy: 'scheduler',
    costCredits: 12,
    duration: 45,
    waitingFor: null,
    jobIds: ['job-1', 'job-2'],
    startedAt: '2026-10-28T07:00:05Z',
    endedAt: '2026-10-28T07:00:50Z',
  },
  {
    id: 'frn-2',
    flowId: 'flw-morning-brief',
    status: 'done',
    triggerSummary: 'schedule',
    startedBy: 'scheduler',
    costCredits: 10,
    duration: 38,
    waitingFor: null,
    jobIds: ['job-3'],
    startedAt: '2026-10-27T07:00:04Z',
    endedAt: '2026-10-27T07:00:42Z',
  },
]

// ── Routines ──────────────────────────────────────────────────────────────────

export const routines: Routine[] = [
  {
    id: 'rtn-morning-brief',
    companyId: 'cmp-1',
    helperId: 'h-chief',
    name: 'Morning brief',
    subtitle: 'Daily morning briefing',
    instructions: 'Summarise overnight activity and surface any blockers.',
    freq: 'daily',
    at: '07:00',
    days: [],
    monthly: null,
    timezone: 'Asia/Jakarta',
    cron: '0 7 * * *',
    sendsTo: [{ channel: 'whatsapp', id: '+628123456789' }],
    enabled: true,
    paused: false,
    managedByChief: true,
    nextAt: '2026-10-29T00:00:00Z',
    lastAt: '2026-10-28T00:00:00Z',
    goalIds: [],
    createdBy: 'operator',
  },
  {
    id: 'rtn-weekly-report',
    companyId: 'cmp-1',
    helperId: 'h-chief',
    name: 'Weekly cross-area report',
    subtitle: 'Monday morning summary',
    instructions: 'Compile weekly highlights from all areas into one summary.',
    freq: 'weekly',
    at: '09:00',
    days: [0],
    monthly: null,
    timezone: 'Asia/Jakarta',
    cron: '0 9 * * 1',
    sendsTo: [],
    enabled: true,
    paused: false,
    managedByChief: false,
    nextAt: '2026-11-03T02:00:00Z',
    lastAt: '2026-10-27T02:00:00Z',
    goalIds: ['g-books'],
    createdBy: 'operator',
  },
]

// ── Knowledge ─────────────────────────────────────────────────────────────────

export const kbSources: KbSource[] = [
  {
    id: 'kbs-1',
    companyId: 'cmp-1',
    kind: 'skill',
    ref: 'skill:skl-passkeys',
    title: 'Passkey rollout runbook',
    contentHash: 'abc123',
    helperId: 'h-dev',
  },
  {
    id: 'kbs-2',
    companyId: 'cmp-1',
    kind: 'upload',
    ref: 'upload:q3-board-deck',
    title: 'Q3 Board Deck',
    contentHash: 'def456',
    helperId: null,
  },
]

export const kbItems: KbItem[] = [
  {
    sourceId: 'kbs-1',
    heading: 'Passkey Rollout',
    text: 'Ship passkeys to web + iOS by Nov 14. Android follows with a password fallback.',
    kind: 'skill',
    score: 0.92,
  },
  {
    sourceId: 'kbs-2',
    heading: 'Q3 Board Deck',
    text: 'Revenue up 12% month over month. Two goals moved, one hire closed.',
    kind: 'upload',
    score: 0.75,
  },
]

// ── Analytics ─────────────────────────────────────────────────────────────────

export const analyticsOverview: AnalyticsOverview = {
  stats: [
    { label: 'Jobs done', value: 142 },
    { label: 'Success rate', value: 94, note: '%' },
    { label: 'Tokens', value: 284_000 },
    { label: 'Spend', value: 1_450, note: 'credits' },
  ],
  series: [
    {
      label: 'Jobs per day',
      labels: ['2026-10-22', '2026-10-23', '2026-10-24', '2026-10-25', '2026-10-26', '2026-10-27', '2026-10-28'],
      values: [18, 22, 25, 19, 24, 21, 13],
    },
  ],
}

export const analyticsHelpers: HelperStat[] = [
  { helperId: 'h-chief', name: 'Chief', jobs: 80, success: 96, tokens: 160_000, spend: 820 },
  { helperId: 'h-dev',   name: 'Dev',   jobs: 42, success: 93, tokens: 98_000,  spend: 430 },
  { helperId: 'h-growth',name: 'Growth',jobs: 20, success: 90, tokens: 26_000,  spend: 200 },
]

// ── Skills ────────────────────────────────────────────────────────────────────

export const skills: Skill[] = [
  {
    id: 'skl-passkeys',
    name: 'Passkey rollout runbook',
    status: 'active',
    version: 2,
    helperId: 'h-dev',
    usageCount: 5,
  },
  {
    id: 'skl-morning-brief',
    name: 'Morning brief template',
    status: 'active',
    version: 1,
    helperId: 'h-chief',
    usageCount: 22,
  },
  {
    id: 'skl-incident-playbook',
    name: 'Incident playbook',
    status: 'draft',
    version: 1,
    helperId: 'h-dev',
    usageCount: 0,
  },
]

// ── Helpers ───────────────────────────────────────────────────────────────────

export const helpers: Helper[] = [
  {
    id: 'h-chief',
    name: 'Chief',
    area: 'brand',
    role: 'Chief of Staff',
    status: 'active',
    isChief: true,
    autonomyCap: 'review_first',
    jobDescription: 'Coordinate across all areas and surface decisions.',
    jobs: 80,
    success: 96,
  },
  {
    id: 'h-dev',
    name: 'Dev',
    area: 'dev',
    role: 'Engineering agent',
    status: 'active',
    isChief: false,
    autonomyCap: 'review_first',
    jobDescription: 'Handle engineering tasks, PRs, and CI.',
    jobs: 42,
    success: 93,
  },
  {
    id: 'h-growth',
    name: 'Growth',
    area: 'marketing',
    role: 'Marketing agent',
    status: 'active',
    isChief: false,
    autonomyCap: 'review_first',
    jobDescription: 'Drive marketing campaigns and content.',
    jobs: 20,
    success: 90,
  },
]

// ── Inbox ─────────────────────────────────────────────────────────────────────

export const inboxItems: InboxItem[] = [
  // Needs you — full decision cards
  {
    id: 'inbox-passkey-tasks',
    title: 'Create 3 tasks for the passkey rollout',
    summary: 'From your chat “Passkey rollout plan”. Splits the goal so web + iOS ship before the Nov 28 freeze; Android follows with a fallback.',
    sessionId: 'sess-passkey',
    channelId: 'ch-engineering',
    kind: 'decision',
    status: 'pending',
    createdAt: '2026-10-24T09:58:00Z',
    asker: 'Chief', askerArea: 'brand',
    askedAgo: 'asked 2m ago',
    needsYou: true,
    proposals: [
      { who: 'Dev',    area: 'dev',       text: 'Ship passkeys on web + iOS',     due: 'Nov 14' },
      { who: 'Dev',    area: 'dev',       text: 'Android password fallback flow', due: 'Nov 21' },
      { who: 'Growth', area: 'marketing', text: 'Launch comms to all users',      due: 'Nov 24' },
    ],
    actions: [
      { label: 'Approve all 3', primary: true, icon: 'check' },
      { label: 'Review one by one' },
      { label: 'Reply', icon: 'reply' },
    ],
    reassurance: 'Nothing runs until you approve',
  },
  {
    id: 'inbox-ad-budget',
    title: 'Approve $4,800 ad budget for the referral launch',
    summary: '14-day spend cap across Meta and TikTok. Last test returned 3.1× on $600; Growth stops automatically at the cap.',
    sessionId: 'sess-ad-budget',
    channelId: 'ch-marketing',
    kind: 'decision',
    status: 'pending',
    createdAt: '2026-10-24T09:35:00Z',
    asker: 'Growth', askerArea: 'marketing',
    askedAgo: 'asked 25m ago',
    needsYou: true,
    actions: [
      { label: 'Approve $4,800', primary: true, icon: 'check' },
      { label: 'Change amount' },
      { label: 'Reply', icon: 'reply' },
    ],
    reassurance: 'Charged only when ads run',
  },

  // Needs you — compact rows
  {
    id: 'inbox-arunika',
    title: 'Pilot contract redlines from Arunika',
    summary: 'Two redlines on the pilot contract need a yes or no.',
    sessionId: 'sess-arunika',
    channelId: 'ch-business',
    kind: 'decision',
    status: 'pending',
    createdAt: '2026-10-24T09:00:00Z',
    asker: 'Sales', askerArea: 'sales',
    askedAgo: '1h',
    needsYou: true,
    compact: true,
  },
  {
    id: 'inbox-venue',
    title: 'Pick an offsite venue — 3 options',
    summary: 'Three venues within budget for the Q1 offsite.',
    sessionId: 'sess-venue',
    channelId: 'ch-general',
    kind: 'decision',
    status: 'pending',
    createdAt: '2026-10-23T16:00:00Z',
    asker: 'Chief', askerArea: 'brand',
    askedAgo: 'Yesterday',
    needsYou: true,
    compact: true,
  },

  // Running now
  {
    id: 'run-passkeys-staging',
    title: 'Shipping passkeys to staging',
    summary: '',
    sessionId: 'sess-passkey',
    channelId: 'ch-engineering',
    kind: 'update',
    status: 'running',
    createdAt: '2026-10-24T09:48:00Z',
    asker: 'Dev', askerArea: 'dev',
    progress: { step: 4, total: 7, elapsed: '12m' },
  },
  {
    id: 'run-rollback-drill',
    title: 'Rollback drill on api-prod',
    summary: '',
    sessionId: 'sess-incident-1',
    channelId: 'ch-engineering',
    kind: 'update',
    status: 'running',
    createdAt: '2026-10-24T09:57:00Z',
    asker: 'Ops', askerArea: 'ops',
    progress: { step: 2, total: 5, elapsed: '3m' },
  },

  // Done today
  {
    id: 'done-brief',
    title: 'Wrote the morning brief',
    summary: 'Quiet night. 2 goals moved, 1 at risk (Postgres 16). Brief sent to WhatsApp.',
    sessionId: 'sess-weekly',
    channelId: 'ch-general',
    kind: 'update',
    status: 'done',
    createdAt: '2026-10-24T06:00:00Z',
    asker: 'Chief', askerArea: 'brand',
    meta: '1m 50s · 5 sources · 11 steps',
  },
  {
    id: 'done-books',
    title: 'Closed October books',
    summary: '2 variances flagged for review: cloud spend +18%, contractor invoices late.',
    sessionId: 'sess-investor',
    channelId: 'ch-general',
    kind: 'update',
    status: 'done',
    createdAt: '2026-10-24T05:00:00Z',
    asker: 'Finance', askerArea: 'finance',
    meta: '6m 12s · 3 sources · 9 steps',
  },
  {
    id: 'done-calendar',
    title: 'Content calendar synced',
    summary: '18 of 22 posts drafted. Gaps in the partner spotlight series noted.',
    sessionId: 'sess-calendar',
    channelId: 'ch-marketing',
    kind: 'update',
    status: 'done',
    createdAt: '2026-10-24T04:00:00Z',
    asker: 'Growth', askerArea: 'marketing',
    meta: '2m 4s · 2 sources · 5 steps',
  },
]

// ── Members ───────────────────────────────────────────────────────────────────

export const members: CompanyMember[] = [
  { id: 'mem-dk', userId: 'usr-dk', name: 'Dede Kurniawan', email: 'dede@saga.co.id', role: 'owner' },
  { id: 'mem-ra', userId: 'usr-ra', name: 'Rina Ayu',       email: 'rina@saga.co.id', role: 'admin' },
  { id: 'mem-by', userId: 'usr-by', name: 'Bayu Pratama',   email: 'bayu@saga.co.id', role: 'member' },
  { id: 'mem-sn', userId: 'usr-sn', name: 'Sari Nur',       email: 'sari@saga.co.id', role: 'member' },
]

// ── sweep/team-analytics ──────────────────────────────────────────────────────
// Demo content for the Team + Analytics screens in mock mode. Mutable so the
// mock commands (retire, channels, tools, skills, files, retry) are reflected
// by the next read.

import type {
  ActivityEntry,
  AnalyticsFailure,
  AnalyticsLoop,
  AnalyticsReliability,
  AnalyticsStackedSeries,
  HelperChannelBinding,
  HelperFile,
  HelperTools,
} from '../../core/domain/types'

const SWEEP_TODAY = new Date()
const iso = (minsAgo: number) => new Date(SWEEP_TODAY.getTime() - minsAgo * 60_000).toISOString()

const MOCK_HELPER_EXTRAS: Record<string, Partial<Helper>> = {
  'h-chief': {
    model: 'Opus 5.5', title: 'Chief of Staff', reportsTo: 'owner', jobsMonth: 112, costMonth: 1_820, loops: 3,
    currentJob: { id: 'job-brief', brief: 'Planning next week', status: 'running' },
    nextRoutine: { id: 'rtn-morning-brief', name: 'Morning brief', nextAt: '2026-10-29T00:00:00Z' },
    lastActive: iso(1), budgetCreditsMonth: 2_500, channelCount: 0,
    behavior: { language: 'Bahasa Indonesia', never_discuss: ['Legal', 'Politics'], handoff_to: 'owner' },
  },
  'h-dev': {
    model: 'Opus 5.5', title: 'Dev · Engineering', reportsTo: 'h-chief', jobsMonth: 61, costMonth: 930, loops: 2,
    currentJob: { id: 'job-pr', brief: 'Opening the PR for the passkey cut-off', status: 'running' },
    lastActive: iso(3), budgetCreditsMonth: null, channelCount: 0,
  },
  'h-growth': {
    model: 'Sonnet 5.5', title: 'Growth · Marketing', reportsTo: 'h-chief', jobsMonth: 19, costMonth: 210, loops: 1,
    currentJob: { id: 'job-ig', brief: 'Your pick between two Instagram drafts', status: 'waiting' },
    lastActive: iso(120), budgetCreditsMonth: null, channelCount: 1,
  },
}
for (const h of helpers) Object.assign(h, MOCK_HELPER_EXTRAS[h.id] ?? {})

/** Per-helper channel bindings (Omilo chat is built in and not listed). */
export const mockHelperChannels: Record<string, HelperChannelBinding[]> = {
  'h-growth': [
    { id: 'hch-wa-growth', helperId: 'h-growth', kind: 'whatsapp', config: { who: 'anyone', when: 'always', handoff: true }, secretsSet: [], status: 'pending_setup' },
  ],
}

export const mockHelperTools: Record<string, HelperTools> = {}
export function mockToolsFor(helperId: string): HelperTools {
  mockHelperTools[helperId] ??= {
    connectors: connectors.map((c, i) => ({ id: c.id, label: c.label, kind: null, status: c.status, on: i < 2, access: i === 0 ? 'write' : 'read' })),
    builtins: [
      { id: 'browser', label: 'Browser', desc: 'Open pages and fill simple forms', on: true },
      { id: 'web_search', label: 'Web search', desc: 'Look things up on the web', on: true },
      { id: 'code_runner', label: 'Code runner', desc: 'Run small scripts on files', on: false },
    ],
  }
  return mockHelperTools[helperId]
}

/** {helperId: {skillId: {enabled, permission}}} */
export const mockHelperSkillSettings: Record<string, Record<string, { enabled: boolean; permission: 'always' | 'ask' }>> = {}

const FILE_DESCRIPTIONS: Record<HelperFile['name'], string> = {
  'PERSONA.md': 'How {n} thinks and what it cares about',
  'STYLE.md': 'Tone, language and formatting',
  'PLAYBOOK.md': 'Step-by-step answers for common cases',
  'MEMORY.md': 'What it remembers between chats',
}
export const mockHelperFiles: Record<string, HelperFile[]> = {}
export function mockFilesFor(helperId: string, name: string): HelperFile[] {
  mockHelperFiles[helperId] ??= (Object.keys(FILE_DESCRIPTIONS) as HelperFile['name'][]).map((f) => ({
    name: f,
    description: FILE_DESCRIPTIONS[f].replace('{n}', name),
    docId: f === 'PLAYBOOK.md' ? `mem-${helperId}-playbook` : null,
    content:
      f === 'PLAYBOOK.md'
        ? '## Common questions\n\n1. Look the answer up before replying — never guess.\n2. Reply short and warm.\n3. Hand anything about money disputes to the owner.'
        : '',
    updatedAt: f === 'PLAYBOOK.md' ? iso(2 * 24 * 60) : null,
    updatedBy: f === 'PLAYBOOK.md' ? `helper:${helperId}` : null,
  }))
  return mockHelperFiles[helperId]
}

const BUCKETS_7 = Array.from({ length: 7 }, (_, i) => {
  const d = new Date(SWEEP_TODAY.getTime() - (6 - i) * 86_400_000).toISOString().slice(0, 10)
  return { start: d, end: d }
})

export const mockAnalyticsBuckets = BUCKETS_7

export const mockJobsSeries = {
  done: [16, 20, 23, 17, 21, 19, 12],
  failed: [0, 1, 0, 0, 2, 1, 0],
}

export const mockSpendByChannel: AnalyticsStackedSeries = {
  buckets: BUCKETS_7,
  total: 1_450,
  series: [
    { key: 'ch-engineering', label: 'Engineering', area: 'dev', values: [110, 140, 160, 30, 20, 190, 120] },
    { key: 'ch-marketing', label: 'Marketing', area: 'marketing', values: [30, 40, 20, 20, 10, 50, 60] },
    { key: 'ch-general', label: 'General', area: 'brand', values: [20, 15, 25, 10, 5, 30, 25] },
  ],
}

export const mockTokensByHelper: AnalyticsStackedSeries = {
  buckets: BUCKETS_7,
  total: 284_000,
  series: [
    { key: 'h-chief', label: 'Chief', area: 'brand', values: [23_000, 20_000, 27_000, 9_000, 8_000, 30_000, 25_000] },
    { key: 'h-dev', label: 'Dev', area: 'dev', values: [14_000, 18_000, 16_000, 4_000, 3_000, 22_000, 21_000] },
    { key: 'h-growth', label: 'Growth', area: 'marketing', values: [3_000, 4_000, 3_000, 2_000, 1_000, 5_000, 8_000] },
  ],
}

export const mockLoops: AnalyticsLoop[] = [
  { id: 'rtn-morning-brief', kind: 'routine', name: 'Morning brief', helperId: 'h-chief', helperName: 'Chief', area: 'brand', schedule: 'Daily · 07:00', nextAt: '2026-10-29T00:00:00Z', lastResult: 'done', runs: 7, avgCost: 12, on: true },
  { id: 'rtn-pr-digest', kind: 'routine', name: 'PR digest to #engineering', helperId: 'h-dev', helperName: 'Dev', area: 'dev', schedule: 'Weekdays · 09:00', nextAt: '2026-10-29T02:00:00Z', lastResult: 'done', runs: 5, avgCost: 4, on: true },
  { id: 'rtn-latency', kind: 'routine', name: 'Weekly latency report', helperId: 'h-dev', helperName: 'Dev', area: 'dev', schedule: 'Fri · 16:00', nextAt: '2026-10-30T09:00:00Z', lastResult: 'failed', runs: 1, avgCost: 21, on: true },
  { id: 'flw-weekly-growth', kind: 'flow', name: 'Weekly growth review', helperId: null, helperName: 'Flow', area: 'marketing', schedule: 'Weekly · 08:00', nextAt: null, lastResult: 'done', runs: 1, avgCost: 35, on: false },
]

export const mockReliability: AnalyticsReliability = {
  stats: [
    { label: 'Success rate', value: 96, prev: 94, note: '%' },
    { label: 'Failed jobs', value: 4, prev: 7 },
    { label: 'Retried and recovered', value: 2, prev: 1, of: 6 },
    { label: 'Median duration', value: 48, prev: 52, note: 's', p95: 190 },
  ],
  causes: [
    { label: 'Expired or missing connection', count: 3 },
    { label: 'Rate limits', count: 2 },
    { label: 'Timeouts', count: 1 },
  ],
  causesTip: 'Most failures come from expired or missing connections. Reconnect them in Connectors.',
}

export const mockFailures: AnalyticsFailure[] = [
  { jobId: 'job-latency', helperId: 'h-dev', helperName: 'Dev', area: 'dev', title: 'Weekly latency report', error: 'Grafana query timed out', cause: 'Timeouts', attempts: 3, at: iso(20 * 60), status: 'failed', action: 'retry' },
  { jobId: 'job-brief-cal', helperId: 'h-chief', helperName: 'Chief', area: 'brand', title: 'Morning brief', error: 'Calendar not connected', cause: 'Expired or missing connection', attempts: 1, at: iso(3 * 24 * 60), status: 'failed', action: 'connect' },
  { jobId: 'job-deploy', helperId: 'h-dev', helperName: 'Dev', area: 'dev', title: 'Deploy failure triage', error: 'GitHub token expired', cause: 'Expired or missing connection', attempts: 2, at: iso(2 * 24 * 60), status: 'recovered', action: 'view' },
]

export const mockActivity: ActivityEntry[] = [
  { id: 'job:a1', at: iso(1), kind: 'started', helperId: 'h-dev', who: 'Dev', area: 'dev', what: 'started Deploy failure triage', meta: 'chat · step 2 of 4' },
  { id: 'proposal:a2', at: iso(13), kind: 'needs_you', helperId: 'h-growth', who: 'Growth', area: 'marketing', what: 'asked you to approve the referral ad budget', meta: 'spend · medium risk' },
  { id: 'job:a3', at: iso(16), kind: 'done', helperId: 'h-dev', who: 'Dev', area: 'dev', what: 'finished Open PR fix/otp-retry', meta: 'chat · 41,200 tokens · 18 cr' },
  { id: 'job:a4', at: iso(4 * 60), kind: 'done', helperId: 'h-chief', who: 'Chief', area: 'brand', what: 'finished Morning brief', meta: 'routine · 12 cr' },
  { id: 'job:a5', at: iso(20 * 60), kind: 'failed', helperId: 'h-dev', who: 'Dev', area: 'dev', what: "couldn't finish Weekly latency report", meta: 'routine · Grafana query timed out' },
]

// ── sweep/control ──
// Demo content for the control panel in mock mode (was inlined in the
// feature components). HTTP mode reads all of this from the backend.
import type {
  AccountInfo,
  AuditEvent,
  CompanyDetail,
  CreditPack,
  DataExport,
  Invite,
  Invoice,
  LedgerEntry,
  ManagedChannel,
  McpServer,
  Payment,
  SeatSummary,
  SignInSession,
  StorageSummary,
  UserPreferences,
} from '../../core/domain/controlPanel'

/** Example Cloud tiers for mock mode (real prices come from the private cloud plugin). */
billingPlans.push(
  {
    id: 'plan_starter', tier: 'starter', name: 'Starter',
    monthlyPriceUsd: 6.25, monthlyPriceIdr: 100_000, yearlyPriceUsd: 62.5, yearlyPriceIdr: 1_000_000,
    includedCredits: 0, seats: 9999, trialDays: 14, maxSeats: null, maxHelpers: null, seatPriceIdr: null, storageGb: 5,
    features: ['5 GB for docs, files and knowledge', 'Unlimited people and helpers', 'Always on in Omilo Cloud', 'Your own AI key'],
    badge: null,
  },
  {
    id: 'plan_team', tier: 'team', name: 'Team',
    monthlyPriceUsd: 18.75, monthlyPriceIdr: 300_000, yearlyPriceUsd: 187.5, yearlyPriceIdr: 3_000_000,
    includedCredits: 0, seats: 9999, trialDays: 14, maxSeats: null, maxHelpers: null, seatPriceIdr: null, storageGb: 50,
    features: ['50 GB for docs, files and knowledge', 'Unlimited people and helpers', 'Always on in Omilo Cloud', 'Email support'],
    badge: 'Most popular',
  },
  {
    id: 'plan_business', tier: 'business', name: 'Business',
    monthlyPriceUsd: 56.25, monthlyPriceIdr: 900_000, yearlyPriceUsd: 562.5, yearlyPriceIdr: 9_000_000,
    includedCredits: 0, seats: 9999, trialDays: 14, maxSeats: null, maxHelpers: null, seatPriceIdr: null, storageGb: 250,
    features: ['250 GB for docs, files and knowledge', 'Unlimited people and helpers', 'SSO and audit log', 'Priority WhatsApp support'],
    badge: null,
  },
)
billingSubscription.planId = 'plan_team'
billingSubscription.planName = 'Team'

export const companyDetail: CompanyDetail = {
  id: 'cmp-mock', name: 'Sahabat Warga', timezone: 'Asia/Jakarta', logoUrl: null, planId: 'plan_team',
  currency: 'IDR', autonomyDefault: 'ask', picRole: null, industry: 'Property',
}

export const seatSummary: SeatSummary = {
  selfHosted: false, unlimited: true, planId: 'plan_team', planName: 'Team', included: null, total: null, max: null,
  available: null, seatPriceIdr: null, canAdd: false, used: 4, pending: 1, viewers: 0, billingInterval: 'monthly',
  periodEnd: '2026-11-30T00:00:00Z',
}

export const creditPacks: CreditPack[] = [
  { id: '2000', credits: 2_000, amountIdr: 100_000, label: '2,000 credits', sub: 'About 3 weeks · small team', badge: null },
  { id: '5000', credits: 5_000, amountIdr: 238_000, label: '5,000 credits', sub: 'About 2 months · most popular', badge: 'Save 6%' },
  { id: '20000', credits: 20_000, amountIdr: 800_000, label: '20,000 credits', sub: 'For busy teams', badge: 'Save 22%' },
]

export const invites: Invite[] = [
  {
    id: 'inv-andi', email: 'andi@saga.co.id', role: 'member', channelIds: ['ch-engineering'],
    channelNames: ['Engineering'], expiresAt: '2026-11-01T00:00:00Z', createdAt: '2026-10-23T09:00:00Z',
    invitedBy: 'Dede Kurniawan',
  },
]

/** Channel access per member (null = all channels) + presence. */
Object.assign(members[0], { channels: null, lastSeenAt: '2026-10-29T10:40:00Z' })
Object.assign(members[1], { channels: null, lastSeenAt: '2026-10-29T08:40:00Z' })
Object.assign(members[2], { channels: ['ch-engineering', 'ch-general'], channelNames: ['Engineering', 'General'], lastSeenAt: '2026-10-29T10:44:00Z' })
Object.assign(members[3], { channels: ['ch-marketing', 'ch-general'], channelNames: ['Marketing', 'General'], lastSeenAt: '2026-10-28T15:00:00Z' })

export const managedChannels: ManagedChannel[] = [
  {
    id: 'ch-general', name: 'General', accent: 'general', icon: null, purpose: null, isDefault: true,
    contextScope: 'isolated', chatCount: 41, goalCount: 3,
    helpers: [{ id: 'h-chief', name: 'Chief', area: 'brand', isChief: true }, { id: 'h-dev', name: 'Dev', area: 'dev', isChief: false }],
    helperCount: 2, peopleCount: null, archived: false, archivedAt: null, muted: false,
  },
  {
    id: 'ch-engineering', name: 'Engineering', accent: 'dev', icon: null, purpose: null, isDefault: false,
    contextScope: 'isolated', chatCount: 24, goalCount: 2,
    helpers: [{ id: 'h-dev', name: 'Dev', area: 'dev', isChief: false }],
    helperCount: 1, peopleCount: 3, archived: false, archivedAt: null, muted: false,
  },
  {
    id: 'ch-marketing', name: 'Marketing', accent: 'marketing', icon: null, purpose: null, isDefault: false,
    contextScope: 'isolated_general', chatCount: 19, goalCount: 1,
    helpers: [{ id: 'h-growth', name: 'Growth', area: 'marketing', isChief: false }],
    helperCount: 1, peopleCount: 3, archived: false, archivedAt: null, muted: false,
  },
  {
    id: 'ch-business', name: 'Business', accent: 'sales', icon: null, purpose: null, isDefault: false,
    contextScope: 'isolated', chatCount: 9, goalCount: 0, helpers: [], helperCount: 0, peopleCount: 2,
    archived: false, archivedAt: null, muted: false,
  },
  {
    id: 'ch-launch-2025', name: 'Launch 2025', accent: 'marketing', icon: null, purpose: null, isDefault: false,
    contextScope: 'isolated', chatCount: 62, goalCount: 0, helpers: [], helperCount: 0, peopleCount: null,
    archived: true, archivedAt: '2026-03-03T00:00:00Z', muted: false,
  },
]

export const auditEvents: AuditEvent[] = [
  { id: 'aud-7', at: '2026-10-29T10:44:00Z', actorType: 'agent', actorId: 'h-chief', actorName: 'Chief', actorArea: 'ops', type: 'approvals', action: 'asked you to approve', target: '3 tasks · Passwordless login', channel: 'Engineering' },
  { id: 'aud-6', at: '2026-10-29T10:43:00Z', actorType: 'agent', actorId: 'h-dev', actorName: 'Dev', actorArea: 'dev', type: 'helpers', action: 'drafted', target: 'Passkey rollout — v1', channel: 'Engineering' },
  { id: 'aud-5', at: '2026-10-29T09:12:00Z', actorType: 'person', actorId: 'usr-dk', actorName: 'Dede Kurniawan', actorArea: null, type: 'approvals', action: 'approved', target: 'Rp 4,8 jt referral ad budget', channel: 'Marketing' },
  { id: 'aud-4', at: '2026-10-29T08:31:00Z', actorType: 'agent', actorId: 'h-dev', actorName: 'Ops', actorArea: 'ops', type: 'helpers', action: 'ran flow', target: 'Deploy failure triage · #214', channel: 'Engineering' },
  { id: 'aud-3', at: '2026-10-28T17:02:00Z', actorType: 'person', actorId: 'usr-ra', actorName: 'Rina Ayu', actorArea: null, type: 'settings', action: 'changed', target: 'Safety & limits', channel: null },
  { id: 'aud-2', at: '2026-10-28T16:20:00Z', actorType: 'agent', actorId: 'h-chief', actorName: 'Finance', actorArea: 'finance', type: 'helpers', action: 'sent', target: 'October close summary', channel: 'Business' },
  { id: 'aud-1', at: '2026-10-28T11:05:00Z', actorType: 'person', actorId: 'usr-dk', actorName: 'Dede Kurniawan', actorArea: null, type: 'approvals', action: 'declined', target: 'Post to Instagram', channel: 'Marketing' },
]

const GB = 1024 ** 3
export const storageSummary: StorageSummary = {
  usedBytes: Math.round(1.24 * GB),
  quotaBytes: 50 * GB,
  segments: [
    { key: 'docs', label: 'Docs', bytes: Math.round(0.82 * GB), counted: true },
    { key: 'files', label: 'Files & artifacts', bytes: Math.round(0.38 * GB), counted: true },
    { key: 'knowledge', label: 'Knowledge', bytes: Math.round(0.04 * GB), counted: true },
    { key: 'chats', label: 'Chats & run logs (free)', bytes: Math.round(2.4 * GB), counted: false },
  ],
}

export const dataExports: DataExport[] = [
  {
    id: 'exp-oct', status: 'ready', filename: 'omilo-export-20261002-0900.zip', sizeBytes: Math.round(3.4 * GB),
    summary: { channel: 4, session: 92, message: 1840, memory_doc: 51, flow: 7 }, error: null,
    createdAt: '2026-10-02T09:00:00Z', expiresAt: '2026-11-03T09:00:00Z',
  },
]

export const accountInfo: AccountInfo = {
  id: 'usr-dk', email: 'dede@saga.co.id', name: 'Dede Kurniawan', avatarUrl: null, role: 'owner',
  companyName: 'Sahabat Warga', twoFactorEnabled: true, emailVerified: true, googleLinked: true,
}

export const userPreferences: UserPreferences = {
  nickname: 'Mas Dede',
  language: 'Bahasa Indonesia',
  notifications: { weekends: false, quietHours: { from: '21:00', to: '08:00' } },
}

export const signInSessions: SignInSession[] = [
  { id: 'usn-mac', label: 'Chrome · Mac', kind: 'desktop', method: 'google', ip: '103.10.0.1', createdAt: '2026-10-20T08:00:00Z', lastSeenAt: '2026-10-29T10:44:00Z', current: true },
  { id: 'usn-iphone', label: 'Safari · iPhone', kind: 'mobile', method: 'password', ip: '103.10.0.2', createdAt: '2026-10-25T08:00:00Z', lastSeenAt: '2026-10-29T08:40:00Z', current: false },
  { id: 'usn-cli', label: 'Command line', kind: 'cli', method: 'password', ip: null, createdAt: '2026-10-02T08:00:00Z', lastSeenAt: '2026-10-28T12:00:00Z', current: false },
]

export const mcpServers: McpServer[] = [
  {
    id: 'mcs-warga', name: 'sahabat-db', kind: 'remote', url: 'https://mcp.sahabatwarga.id/mcp', authType: 'bearer',
    tokenHint: 'xb-1…31Yu', status: 'connected', error: null, enabled: true, createdAt: '2026-10-12T00:00:00Z',
    tools: [
      { name: 'find_resident', description: 'Look up a resident by unit or phone', level: 'read' },
      { name: 'create_visitor_pass', description: 'New guest QR pass', level: 'ask' },
      { name: 'log_complaint', description: 'Save a complaint ticket', level: 'ask' },
      { name: 'delete_resident', description: 'Remove a resident record', level: 'blocked' },
    ],
  },
]

export const invoices: Invoice[] = [
  { id: 'inv-oct', amount: 2_000_000, currency: 'IDR', status: 'paid', period: '2026-10', provider: 'doit', createdAt: '2026-10-01T00:00:00Z' },
  { id: 'inv-sep', amount: 2_000_000, currency: 'IDR', status: 'paid', period: '2026-09', provider: 'doit', createdAt: '2026-09-01T00:00:00Z' },
]

export const ledgerEntries: LedgerEntry[] = [
  { id: 'cl-3', delta: 5_000, reason: 'topup', creditsCharged: 0, createdAt: '2026-10-21T09:00:00Z', helperId: null, balanceAfter: 5_650 },
  { id: 'cl-2', delta: -350, reason: 'job', creditsCharged: 350, createdAt: '2026-10-20T09:00:00Z', helperId: 'h-dev', balanceAfter: 650 },
  { id: 'cl-1', delta: 40_000, reason: 'subscription_grant', creditsCharged: 0, createdAt: '2026-10-01T00:00:00Z', helperId: null, balanceAfter: 41_000 },
]

export const payments: Payment[] = [
  { id: 'pay-seats', kind: 'seats', status: 'pending', credits: 0, amountIdr: 77_000, hostedUrl: 'https://checkout.mayar.id/demo', planId: 'plan_team', createdAt: '2026-10-29T10:00:00Z' },
]

export const telemetryState = { optedOut: false }

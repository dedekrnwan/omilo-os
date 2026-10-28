import type {
  AiAccount,
  AnalyticsOverview,
  BillingPlan,
  BillingSubscription,
  Channel,
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

export const billingPlans: BillingPlan[] = [
  {
    id: 'plan-cloud',
    tier: 'cloud',
    name: 'Cloud',
    monthlyPriceUsd: 39,
    monthlyPriceIdr: 599_000,
    yearlyPriceUsd: 31,
    yearlyPriceIdr: 479_000,
    includedCredits: 2_000,
    seats: 5,
    trialDays: 14,
  },
]

export const billingSubscription: BillingSubscription = {
  planId: 'plan-cloud',
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

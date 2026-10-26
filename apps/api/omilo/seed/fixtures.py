"""Demo seed fixtures — verbatim port of src/adapters/mock/fixtures.ts.

All fixture ids and field values must match the TypeScript source exactly so
that the UI (which hardcodes ids like 'ch-general', 'f-q4', 'sess-passkey')
continues to work when pointed at the live API.
"""

# ---------------------------------------------------------------------------
# Company + owner user
# ---------------------------------------------------------------------------

DEMO_COMPANY = {
    "id": "cmp_demo",
    "name": "Omilo Demo",
    "color": "#6366f1",
    "timezone": "Asia/Jakarta",
}

DEMO_USER = {
    "id": "usr_demo_owner",
    "email": "demo@omilo.app",
    "name": "Demo Owner",
    "password": "demo-password-1234",
}

DEMO_MEMBER = {
    "id": "mbr_demo_owner",
    "company_id": "cmp_demo",
    "user_id": "usr_demo_owner",
    "role": "owner",
}

# ---------------------------------------------------------------------------
# Channels (4)
# ---------------------------------------------------------------------------

CHANNELS = [
    {
        "id": "ch-general",
        "name": "General",
        "accent": "general",
        "is_default": True,
        "agent_count": 0,
        "chat_count": 31,
        "open_items": 2,
    },
    {
        "id": "ch-engineering",
        "name": "Engineering",
        "accent": "dev",
        "is_default": None,
        "agent_count": 3,
        "chat_count": 24,
        "open_items": 5,
    },
    {
        "id": "ch-marketing",
        "name": "Marketing",
        "accent": "marketing",
        "is_default": None,
        "agent_count": 2,
        "chat_count": 18,
        "open_items": 4,
    },
    {
        "id": "ch-business",
        "name": "Business",
        "accent": "sales",
        "is_default": None,
        "agent_count": 2,
        "chat_count": 9,
        "open_items": 3,
    },
]

# ---------------------------------------------------------------------------
# Goals (10)
# ---------------------------------------------------------------------------

GOALS = [
    # General (3)
    {"id": "g-books",    "channel_id": "ch-general",     "title": "Close October books",     "progress": 70},
    {"id": "g-referral", "channel_id": "ch-general",     "title": "Launch referral program", "progress": 35},
    {"id": "g-offsite",  "channel_id": "ch-general",     "title": "Plan Q1 offsite",         "progress": 10},
    # Engineering (4)
    {"id": "g-passkeys", "channel_id": "ch-engineering", "title": "Passwordless login by Q4", "progress": 40},
    {"id": "g-pg16",     "channel_id": "ch-engineering", "title": "Postgres 16 upgrade",      "progress": 55},
    {"id": "g-ci",       "channel_id": "ch-engineering", "title": "CI under 10 minutes",      "progress": 20},
    {"id": "g-uptime",   "channel_id": "ch-engineering", "title": "99.95% API uptime",        "progress": 80},
    # Marketing (2)
    {"id": "g-ref-launch", "channel_id": "ch-marketing", "title": "Referral launch",       "progress": 35},
    {"id": "g-content",    "channel_id": "ch-marketing", "title": "November content plan", "progress": 60},
    # Business (1)
    {"id": "g-pilot",    "channel_id": "ch-business",   "title": "Close Arunika pilot",   "progress": 50},
]

# ---------------------------------------------------------------------------
# Folders (10)
# ---------------------------------------------------------------------------

FOLDERS = [
    # General (3)
    {"id": "f-offsite",   "channel_id": "ch-general",     "name": "Company offsite", "count": 4},
    {"id": "f-board",     "channel_id": "ch-general",     "name": "Board prep",      "count": 3},
    {"id": "f-ideas",     "channel_id": "ch-general",     "name": "Ideas",           "count": 2},
    # Engineering (3)
    {"id": "f-q4",        "channel_id": "ch-engineering", "name": "Q4 Launch",        "count": 6},
    {"id": "f-infra",     "channel_id": "ch-engineering", "name": "Infra migration",  "count": 3},
    {"id": "f-incidents", "channel_id": "ch-engineering", "name": "Incident reviews", "count": 2},
    # Marketing (2)
    {"id": "f-referral",  "channel_id": "ch-marketing",  "name": "Referral launch",  "count": 3},
    {"id": "f-brand",     "channel_id": "ch-marketing",  "name": "Brand refresh",    "count": 2},
    # Business (2)
    {"id": "f-pilots",    "channel_id": "ch-business",   "name": "Pilots",           "count": 2},
    {"id": "f-pricing",   "channel_id": "ch-business",   "name": "Pricing",          "count": 1},
]

# ---------------------------------------------------------------------------
# Sessions (32)
#
# `participants` is stored as a JSONB list; `updated` is stored verbatim as a
# relative label string (matching the fixture string exactly).
# ---------------------------------------------------------------------------

_chief_and_dev = [
    {"name": "Chief", "area": "brand"},
    {"name": "Dev",   "area": "dev"},
]

SESSIONS = [
    # ── General — Recent (6) ────────────────────────────────────────────────
    {
        "id": "sess-investor",
        "channel_id": "ch-general",
        "title": "October investor update",
        "updated": "now",
    },
    {
        "id": "sess-vendors",
        "channel_id": "ch-general",
        "title": "Vendor renewals owner?",
        "updated": "1h",
        "unread": True,
    },
    {
        "id": "sess-weekly",
        "channel_id": "ch-general",
        "title": "Weekly cross-area summary",
        "updated": "3h",
    },
    {
        "id": "sess-holiday",
        "channel_id": "ch-general",
        "title": "Holiday schedule FAQ",
        "updated": "Yesterday",
    },
    {
        "id": "sess-venue",
        "channel_id": "ch-general",
        "title": "Offsite venue shortlist",
        "updated": "Mon",
    },
    {
        "id": "sess-welcome",
        "channel_id": "ch-general",
        "title": "New hire welcome note",
        "updated": "Oct 18",
    },
    # ── General — Folders (4) ───────────────────────────────────────────────
    {
        "id": "sess-offsite-1",
        "channel_id": "ch-general",
        "folder_id": "f-offsite",
        "title": "Offsite agenda draft",
        "updated": "2d",
    },
    {
        "id": "sess-offsite-2",
        "channel_id": "ch-general",
        "folder_id": "f-offsite",
        "title": "Travel budget per head",
        "updated": "3d",
    },
    {
        "id": "sess-board-1",
        "channel_id": "ch-general",
        "folder_id": "f-board",
        "title": "Q3 board deck outline",
        "updated": "1w",
    },
    {
        "id": "sess-ideas-1",
        "channel_id": "ch-general",
        "folder_id": "f-ideas",
        "title": "Loyalty program idea",
        "updated": "2w",
    },
    # ── Engineering — Q4 Launch folder (6) ─────────────────────────────────
    {
        "id": "sess-passkey",
        "channel_id": "ch-engineering",
        "folder_id": "f-q4",
        "title": "Passkey rollout plan",
        "updated": "now",
        "goal": "Passwordless login by Q4",
        "participants": _chief_and_dev,
    },
    {
        "id": "sess-launch-comms",
        "channel_id": "ch-engineering",
        "folder_id": "f-q4",
        "title": "Launch day comms",
        "updated": "2h",
        "participants": _chief_and_dev,
    },
    {
        "id": "sess-freeze",
        "channel_id": "ch-engineering",
        "folder_id": "f-q4",
        "title": "Freeze exceptions policy",
        "updated": "1d",
        "participants": _chief_and_dev,
    },
    {
        "id": "sess-q4-4",
        "channel_id": "ch-engineering",
        "folder_id": "f-q4",
        "title": "Staging smoke tests",
        "updated": "2d",
    },
    {
        "id": "sess-q4-5",
        "channel_id": "ch-engineering",
        "folder_id": "f-q4",
        "title": "Feature flag cleanup",
        "updated": "3d",
    },
    {
        "id": "sess-q4-6",
        "channel_id": "ch-engineering",
        "folder_id": "f-q4",
        "title": "Release notes draft",
        "updated": "4d",
    },
    # ── Engineering — Other folders (2) ────────────────────────────────────
    {
        "id": "sess-infra-1",
        "channel_id": "ch-engineering",
        "folder_id": "f-infra",
        "title": "Move workers to Fargate",
        "updated": "2d",
    },
    {
        "id": "sess-incident-1",
        "channel_id": "ch-engineering",
        "folder_id": "f-incidents",
        "title": "Checkout 429 storm",
        "updated": "3d",
    },
    # ── Engineering — Recent (6) ────────────────────────────────────────────
    {
        "id": "sess-flaky",
        "channel_id": "ch-engineering",
        "title": "Flaky e2e tests on CI",
        "updated": "now",
    },
    {
        "id": "sess-deploy",
        "channel_id": "ch-engineering",
        "title": "Why did deploy #482 fail?",
        "updated": "1h",
        "unread": True,
    },
    {
        "id": "sess-pg16",
        "channel_id": "ch-engineering",
        "title": "Postgres 16 upgrade checklist",
        "updated": "3h",
    },
    {
        "id": "sess-retro",
        "channel_id": "ch-engineering",
        "title": "Sprint 42 retro notes",
        "updated": "Yesterday",
    },
    {
        "id": "sess-oncall",
        "channel_id": "ch-engineering",
        "title": "On-call handover template",
        "updated": "Mon",
    },
    {
        "id": "sess-ratelimit",
        "channel_id": "ch-engineering",
        "title": "Rate limiter design review",
        "updated": "Oct 18",
    },
    # ── Marketing (5) ───────────────────────────────────────────────────────
    {
        "id": "sess-ad-budget",
        "channel_id": "ch-marketing",
        "folder_id": "f-referral",
        "title": "Referral launch budget",
        "updated": "25m",
    },
    {
        "id": "sess-ref-copy",
        "channel_id": "ch-marketing",
        "folder_id": "f-referral",
        "title": "Referral email copy",
        "updated": "1d",
    },
    {
        "id": "sess-brand-1",
        "channel_id": "ch-marketing",
        "folder_id": "f-brand",
        "title": "Logo refresh brief",
        "updated": "1w",
    },
    {
        "id": "sess-campaign",
        "channel_id": "ch-marketing",
        "title": "Campaign launch debrief",
        "updated": "2h",
    },
    {
        "id": "sess-calendar",
        "channel_id": "ch-marketing",
        "title": "Content calendar review",
        "updated": "Yesterday",
    },
    # ── Business (3) ────────────────────────────────────────────────────────
    {
        "id": "sess-arunika",
        "channel_id": "ch-business",
        "folder_id": "f-pilots",
        "title": "Pilot contract redlines",
        "updated": "1h",
        "unread": True,
    },
    {
        "id": "sess-pricing",
        "channel_id": "ch-business",
        "folder_id": "f-pricing",
        "title": "Annual pricing tiers",
        "updated": "3d",
    },
    {
        "id": "sess-pipeline",
        "channel_id": "ch-business",
        "title": "Pipeline review",
        "updated": "Mon",
    },
]

# ---------------------------------------------------------------------------
# Message author objects (verbatim from fixtures.ts)
# ---------------------------------------------------------------------------

_chief = {"kind": "helper", "name": "Chief", "role": "Chief of Staff",    "area": "brand"}
_dev   = {"kind": "helper", "name": "Dev",   "role": "Engineering agent", "area": "dev"}
_growth = {"kind": "helper", "name": "Growth", "role": "Marketing agent", "area": "marketing"}
_you   = {"kind": "you",    "name": "You"}
_sales = {"kind": "helper", "name": "Sales",  "role": "Sales agent",      "area": "sales"}

# ---------------------------------------------------------------------------
# Messages (16)
# ---------------------------------------------------------------------------

MESSAGES = [
    # ── Passkey rollout plan (5) ────────────────────────────────────────────
    {
        "id": "msg-pk-1",
        "session_id": "sess-passkey",
        "author": _you,
        "content": "Can we ship passkeys to everyone before the Q4 code freeze on Nov 28?",
        "created_at": "2026-10-22T10:40:00Z",
    },
    {
        "id": "msg-pk-2",
        "session_id": "sess-passkey",
        "author": _chief,
        "content": (
            "Yes — if we split it in two. Your Engineering goal "
            "“Passwordless login by Q4” is at 40%, and the blocker is WebAuthn "
            "on the legacy Android app. I’m pulling Dev in to size it."
        ),
        "created_at": "2026-10-22T10:41:00Z",
    },
    {
        "id": "msg-pk-3",
        "session_id": "sess-passkey",
        "author": _dev,
        "content": "Chief added Dev to this chat",
        "created_at": "2026-10-22T10:42:00Z",
        "system": True,
    },
    {
        "id": "msg-pk-4",
        "session_id": "sess-passkey",
        "author": _dev,
        "content": (
            "Sized it. Web + iOS can ship Nov 14 (≈3 days). Legacy Android needs a "
            "password fallback flow, ≈5 days. Rollout doc is drafted in this channel’s Docs."
        ),
        "created_at": "2026-10-22T10:43:00Z",
        "attachment": {"title": "Passkey rollout — v1", "meta": "Doc · Engineering · edited just now"},
    },
    {
        "id": "msg-pk-5",
        "session_id": "sess-passkey",
        "author": _chief,
        "content": (
            "Want me to turn this into 3 tasks under the goal? "
            "They’ll show up in Office mode for tracking and approvals."
        ),
        "created_at": "2026-10-22T10:44:00Z",
        "actions": [{"label": "Create 3 tasks in Goal", "primary": True}, {"label": "Not yet"}],
    },
    # ── Launch day comms (2) ────────────────────────────────────────────────
    {
        "id": "msg-lc-1",
        "session_id": "sess-launch-comms",
        "author": _you,
        "content": "Draft the launch-day announcement for passkeys.",
        "created_at": "2026-10-22T08:10:00Z",
    },
    {
        "id": "msg-lc-2",
        "session_id": "sess-launch-comms",
        "author": _chief,
        "content": (
            "Drafted a short in-app banner and an email. Growth will send them "
            "once web + iOS are live on Nov 14."
        ),
        "created_at": "2026-10-22T08:12:00Z",
    },
    # ── Flaky e2e tests (2) ─────────────────────────────────────────────────
    {
        "id": "msg-fl-1",
        "session_id": "sess-flaky",
        "author": _you,
        "content": "Why are the checkout e2e tests flaky again?",
        "created_at": "2026-10-24T09:02:00Z",
    },
    {
        "id": "msg-fl-2",
        "session_id": "sess-flaky",
        "author": _dev,
        "content": (
            "Two tests wait on a fixed 2s timeout for the payment iframe. "
            "I’ll switch them to wait for the iframe’s ready event."
        ),
        "created_at": "2026-10-24T09:03:00Z",
    },
    # ── October investor update (2) ─────────────────────────────────────────
    {
        "id": "msg-inv-1",
        "session_id": "sess-investor",
        "author": _you,
        "content": "Start the October investor update.",
        "created_at": "2026-10-24T08:30:00Z",
    },
    {
        "id": "msg-inv-2",
        "session_id": "sess-investor",
        "author": _chief,
        "content": (
            "Here’s a first outline: revenue up 12% month over month, two goals moved, "
            "one hire closed. Want me to pull the numbers from Finance?"
        ),
        "created_at": "2026-10-24T08:31:00Z",
    },
    # ── Offsite venue shortlist (1) ─────────────────────────────────────────
    {
        "id": "msg-ven-1",
        "session_id": "sess-venue",
        "author": _chief,
        "content": "I found 3 venues within budget for the Q1 offsite. Pick one and I’ll hold the date.",
        "created_at": "2026-10-23T16:00:00Z",
    },
    # ── Referral launch budget (1) ──────────────────────────────────────────
    {
        "id": "msg-ad-1",
        "session_id": "sess-ad-budget",
        "author": _growth,
        "content": (
            "The referral test returned 3.1× on $600. I’d like a $4,800 cap "
            "over 14 days across Meta and TikTok."
        ),
        "created_at": "2026-10-24T09:35:00Z",
    },
    # ── Campaign launch debrief (2) ─────────────────────────────────────────
    {
        "id": "msg-cmp-1",
        "session_id": "sess-campaign",
        "author": _you,
        "content": "The campaign wrapped up yesterday. What were the key numbers?",
        "created_at": "2026-10-24T09:00:00Z",
    },
    {
        "id": "msg-cmp-2",
        "session_id": "sess-campaign",
        "author": _growth,
        "content": (
            "Total reach: 240k impressions, 3.8% CTR, 12% conversion on the landing page "
            "— above our 9% target."
        ),
        "created_at": "2026-10-24T09:01:00Z",
    },
    # ── Pilot contract redlines (1) ─────────────────────────────────────────
    {
        "id": "msg-aru-1",
        "session_id": "sess-arunika",
        "author": _sales,
        "content": (
            "Arunika sent redlines on the pilot contract: a 60-day term instead of 90, "
            "and a data-export clause. Both look acceptable."
        ),
        "created_at": "2026-10-24T08:40:00Z",
    },
]

# ---------------------------------------------------------------------------
# Inbox items (9)
# ---------------------------------------------------------------------------

INBOX_ITEMS = [
    # ── Needs you — full decision cards (2) ─────────────────────────────────
    {
        "id": "inbox-passkey-tasks",
        "title": "Create 3 tasks for the passkey rollout",
        "summary": (
            "From your chat “Passkey rollout plan”. Splits the goal so web + iOS "
            "ship before the Nov 28 freeze; Android follows with a fallback."
        ),
        "session_id": "sess-passkey",
        "channel_id": "ch-engineering",
        "kind": "decision",
        "status": "pending",
        "created_at": "2026-10-24T09:58:00Z",
        "asker": "Chief",
        "asker_area": "brand",
        "asked_ago": "asked 2m ago",
        "needs_you": True,
        "proposals": [
            {"who": "Dev",    "area": "dev",       "text": "Ship passkeys on web + iOS",     "due": "Nov 14"},
            {"who": "Dev",    "area": "dev",       "text": "Android password fallback flow", "due": "Nov 21"},
            {"who": "Growth", "area": "marketing", "text": "Launch comms to all users",      "due": "Nov 24"},
        ],
        "actions": [
            {"label": "Approve all 3", "primary": True, "icon": "check"},
            {"label": "Review one by one"},
            {"label": "Reply", "icon": "reply"},
        ],
        "reassurance": "Nothing runs until you approve",
    },
    {
        "id": "inbox-ad-budget",
        "title": "Approve $4,800 ad budget for the referral launch",
        "summary": (
            "14-day spend cap across Meta and TikTok. Last test returned 3.1× on $600; "
            "Growth stops automatically at the cap."
        ),
        "session_id": "sess-ad-budget",
        "channel_id": "ch-marketing",
        "kind": "decision",
        "status": "pending",
        "created_at": "2026-10-24T09:35:00Z",
        "asker": "Growth",
        "asker_area": "marketing",
        "asked_ago": "asked 25m ago",
        "needs_you": True,
        "actions": [
            {"label": "Approve $4,800", "primary": True, "icon": "check"},
            {"label": "Change amount"},
            {"label": "Reply", "icon": "reply"},
        ],
        "reassurance": "Charged only when ads run",
    },
    # ── Needs you — compact rows (2) ────────────────────────────────────────
    {
        "id": "inbox-arunika",
        "title": "Pilot contract redlines from Arunika",
        "summary": "Two redlines on the pilot contract need a yes or no.",
        "session_id": "sess-arunika",
        "channel_id": "ch-business",
        "kind": "decision",
        "status": "pending",
        "created_at": "2026-10-24T09:00:00Z",
        "asker": "Sales",
        "asker_area": "sales",
        "asked_ago": "1h",
        "needs_you": True,
        "compact": True,
    },
    {
        "id": "inbox-venue",
        "title": "Pick an offsite venue — 3 options",
        "summary": "Three venues within budget for the Q1 offsite.",
        "session_id": "sess-venue",
        "channel_id": "ch-general",
        "kind": "decision",
        "status": "pending",
        "created_at": "2026-10-23T16:00:00Z",
        "asker": "Chief",
        "asker_area": "brand",
        "asked_ago": "Yesterday",
        "needs_you": True,
        "compact": True,
    },
    # ── Running now (2) ─────────────────────────────────────────────────────
    {
        "id": "run-passkeys-staging",
        "title": "Shipping passkeys to staging",
        "summary": "",
        "session_id": "sess-passkey",
        "channel_id": "ch-engineering",
        "kind": "update",
        "status": "running",
        "created_at": "2026-10-24T09:48:00Z",
        "asker": "Dev",
        "asker_area": "dev",
        "progress": {"step": 4, "total": 7, "elapsed": "12m"},
    },
    {
        "id": "run-rollback-drill",
        "title": "Rollback drill on api-prod",
        "summary": "",
        "session_id": "sess-incident-1",
        "channel_id": "ch-engineering",
        "kind": "update",
        "status": "running",
        "created_at": "2026-10-24T09:57:00Z",
        "asker": "Ops",
        "asker_area": "ops",
        "progress": {"step": 2, "total": 5, "elapsed": "3m"},
    },
    # ── Done today (3) ───────────────────────────────────────────────────────
    {
        "id": "done-brief",
        "title": "Wrote the morning brief",
        "summary": (
            "Quiet night. 2 goals moved, 1 at risk (Postgres 16). "
            "Brief sent to WhatsApp."
        ),
        "session_id": "sess-weekly",
        "channel_id": "ch-general",
        "kind": "update",
        "status": "done",
        "created_at": "2026-10-24T06:00:00Z",
        "asker": "Chief",
        "asker_area": "brand",
        "meta": "1m 50s · 5 sources · 11 steps",
    },
    {
        "id": "done-books",
        "title": "Closed October books",
        "summary": "2 variances flagged for review: cloud spend +18%, contractor invoices late.",
        "session_id": "sess-investor",
        "channel_id": "ch-general",
        "kind": "update",
        "status": "done",
        "created_at": "2026-10-24T05:00:00Z",
        "asker": "Finance",
        "asker_area": "finance",
        "meta": "6m 12s · 3 sources · 9 steps",
    },
    {
        "id": "done-calendar",
        "title": "Content calendar synced",
        "summary": "18 of 22 posts drafted. Gaps in the partner spotlight series noted.",
        "session_id": "sess-calendar",
        "channel_id": "ch-marketing",
        "kind": "update",
        "status": "done",
        "created_at": "2026-10-24T04:00:00Z",
        "asker": "Growth",
        "asker_area": "marketing",
        "meta": "2m 4s · 2 sources · 5 steps",
    },
]

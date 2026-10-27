# 09 · Realtime & Notifications

> Track: **technical**. How the UI stays live without polling: an SSE event bus for feeds, a
> WebSocket for interactive chat/job observation, and Web Push for out-of-app nudges. All
> fanned out from `RunEvent`/domain events over Redis pub/sub, per company.

## 1. Transport choices

| Need | Transport | Why |
|---|---|---|
| Feed updates (inbox, goals, flow/routine runs, analytics ticks, "Chief is working") | **SSE** `GET /v1/stream` | one-way, cheap, auto-reconnect, proxy-friendly. |
| Interactive chat; observe one running Job token-by-token | **WebSocket** `WS /v1/ws/sessions/{id}`, `WS /v1/ws/jobs/{id}` | bidirectional, low-latency streaming of `RunEvent`s. |
| Out-of-app notification (decisions needing you) | **Web Push** (`pywebpush`) | reaches desktop/web when the app is closed. |

Rationale: most of the UI is *observing* server-authoritative state → SSE is the default and
keeps connection count low. Chat needs send+stream in one socket → WS. Approvals that can't
wait for the app to be open → Push.

## 2. Event bus (SSE)

- `GET /v1/stream` opens a per-user SSE stream **bound to the active `company_id`** at connect
  (RLS + channel scope applied).
- Worker/gateway publish domain events to Redis `events:{company_id}`; the gateway relays
  matching events to each subscriber as `{type, id, data}`.
- **Event types** (envelope `data` is the changed entity or a thin ref):

```
inbox.created | inbox.updated | inbox.resolved
job.started   | job.progress  | job.done | job.failed
goal.updated  (progress/status)
routine.run_started | routine.run_done
flow.run_started | flow.run_updated | flow.run_done
notice.created        (notification ladder)
account.updated       (pool status/usage window changed)
usage.updated         (credit balance changed)
```

- Client maps each event to a **React Query** cache update (invalidate/patch the matching key)
  or appends to a live list. This is how the Inbox badge, routine sparklines, "Working now"
  counts, and the AI-accounts meters update in place.

## 3. Interactive chat (WS)

```
client → {type:"user_message", content, attachments?}
server ← {type:"message_saved", message}              # your message persisted
         # a Helper Job starts; its RunEvents stream:
server ← {type:"run_event", kind:"thinking"|"text"|"tool"|"sources"|"browser", data}
server ← {type:"message_saved", message}              # final helper Message persisted
server ← {type:"job_done"|"job_failed", job_id}
```

- Sending to the Chief DM (`scope=chief_dm`) runs the **supervisor** (planning) before the
  worker turn; a normal channel chat runs just the worker.
- Backpressure: `RunEvent` text is chunked; the socket drops to a summary if the client lags.
- Reconnect: client resumes with `?after_event_id=` to backfill missed `RunEvent`s for the Job.

## 4. Job / run observation (WS)

`WS /v1/ws/jobs/{id}` streams a single Job's `RunEvent`s — used by the **Flow run** and
**Routine run** detail views and the "Chief is working on the morning brief" live indicator.
Read-only; same event shapes as chat's `run_event`.

## 5. Notifications (ladder + Push)

Ported from omilo-os (`Notice`/`Notification`/`PushSub`): a **nudge ladder** decides *how* to
notify so the operator isn't spammed.

- A `needs_you` InboxItem creates a `Notice`; the ladder escalates: in-app badge → merge
  similar → Web Push → (optionally) Chief surfaces it in the morning brief.
- `POST /v1/push/subscribe {endpoint, keys}` registers a browser/desktop push target;
  `pywebpush` delivers `{title, body, url, tag, level}`. Tauri maps these to native
  notifications (see [`10`](10-tauri-desktop.md)).
- Levels: `info` (FYI), `decision` (needs approval), `critical` (blocking/failure). Only
  `decision`/`critical` push by default; `info` stays in-app.
- Snooze/seen/acted transitions are recorded (`Notification.action`) so the ladder doesn't
  re-nudge something already handled.

## 6. Scaling & reliability

- **Fan-out** via Redis pub/sub; multiple gateway replicas each subscribe and relay to their
  own connected clients. No sticky sessions required for SSE (stateless replay via
  `after_event_id`).
- **Delivery semantics:** at-least-once for SSE/WS with client-side dedup by `event_id`; the DB
  is always the source of truth, events are hints to refetch/patch.
- **Presence/typing** (optional, later): ephemeral, Redis-only, never persisted.
- **Limits:** per-user max concurrent streams; idle SSE heartbeats every ~20s; WS ping/pong.

## 7. Security

- Every stream/socket authenticates (access JWT) and binds to one `company_id`; events are only
  relayed for that tenant's Redis channel.
- No tenant data crosses a channel boundary; channel-scoped members only receive events for
  their channels.
- Push payloads carry no secrets — just a title/body/url the client resolves after auth.

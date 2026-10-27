# 05 · MCP Surfaces

> Track: **technical**. How agents operate the platform and the outside world — safely.
> omilo exposes its own features (Goals, Routines, Flows, Docs, Knowledge) and external
> connectors to agents as **MCP tools**. Agents never hold credentials and never call
> side-effecting tools directly: they **propose**, the gateway **decides**. Ported from
> omilo-os `mcp_server.py`.

## 1. Model

- **One MCP endpoint per agent.** `POST /mcp` authenticated by
  `Authorization: Bearer <helper_mcp_token>` (hash stored on `Helper`). The token identifies
  the Helper, its company (RLS), its granted resources, and its effective autonomy.
- **Transport:** JSON-RPC 2.0 over Streamable HTTP (MCP spec). Supported protocol versions
  mirror omilo-os (`2025-11-25`, `2025-06-18`, `2025-03-26`, `2024-11-05`).
- **Every call is logged** to `ToolCall` with `decision ∈ {allowed, proposal, refused, error}`
  and duration — feeding Activity + analytics.
- **The platform looks "alive"** because its native surfaces are just MCP tools any authorized
  agent can call — so a Helper can file a goal update, schedule a routine, draft a flow, or
  write a doc, the same way it reads the web.

## 2. Two tiers of tools

### a) Platform tools (native MCP — omilo operating itself)
These are the feature surfaces. Reads are `allowed` by scope; writes route through the gate.

| Tool | Does | Policy |
|---|---|---|
| `whoami` | Helper identity, role, job, permissions, autonomy | none |
| `get_context` | Company knowledge (handbook: profile, goals, voice, rules, systems, KPIs) | read scope |
| `get_task` | Current Job brief + checkpoint + approved text | own job |
| `checkpoint` | Save progress (plan/done/next/notes) | always |
| `report` | Close a Job: headline, body, KPIs | always |
| `recall` | Hybrid KB search (meaning + words), by `kinds` | read scope |
| `remember` | Keep a fact in Memory notes | own helper |
| `kb_add` | Add a file/url/note to the KB | ask → proposal if external |
| `propose` | File an approval item in the Inbox (type, risk, body) | **gate** |
| `request_action` | Ask the gate: allowed / needs_approval / refused | **gate** |
| `get_approved` | Read approved proposals awaiting execution | own items |
| `mark_executed` | Confirm an approved action was carried out (with evidence) | approved only |
| `post_message` | Progress note into the Job/Session thread | own thread |
| `ask_operator` | Ask the human a question (returns as a new Job when answered) | rate-limited |
| `goals_*` | `goals_list / goals_update_progress / goals_propose` | read / gate |
| `routines_*` | `routines_list / routines_propose / routines_run_now` | read / gate |
| `flows_*` | `flows_list / flows_draft / flows_publish` | read / **gate** (publish) |
| `docs_search / docs_read / docs_write` | Docs vault (`[[links]]`) | read / gate (write) |
| `skills_list / skill_read / skill_save / skill_publish` | Skills | read / gate (publish) |
| `ask_teammate / read_team_chat` | Peer communication (staff room) | own company |
| `propose_helper` | Suggest a new Helper to the operator | gate |
| `request_access` | Ask for a folder/connector/skill grant | gate |

### b) Connector tools (external world)
Generated from each enabled `Connector` (Gmail, Google Calendar/Drive, Slack, WhatsApp, Notion,
a CRM, an ads/analytics platform, a read-only database for reporting, the browser, or any MCP
URL). Read tools may be `auto`; write tools default to `ask` (→ proposal). Agents reach external
systems **outbound only** (call + scheduled poll); there is no inbound webhook surface. See
[`integrations/README.md`](../integrations/README.md).

## 3. The golden rule: propose, don't act

Agents **cannot** perform a consequential action by calling a tool. The flow is always:

```
agent: request_action({type:"message", risk:"medium", payload:{...}})
gateway gate: decide(effective_autonomy, risk, type, safety) →
   • allowed      → returns a one-time execution token; agent calls the connector tool;
                    gateway executes & logs; (Chief auto-approved on operator's behalf)
   • needs_owner  → creates Proposal + InboxItem; tool returns {status:"pending", proposal_id}
                    (the graph interrupts; agent's turn ends)
   • refused      → {status:"refused", reason}  (hard SafetyLimit)
```

This keeps the human-in-the-loop seam in one place (the gate) and makes `yolo` safe: even
fully autonomous, actions are gated by `SafetyLimit` and fully audited. Policy table in
[`business/autonomy.md`](../business/autonomy.md).

## 4. Credentials & isolation

- Connector secrets are **encrypted at rest** (`secrets_enc`), never logged, never returned to
  the agent. The gateway injects them only at execution time.
- Each agent gets **its own** MCP token and resource grants (`HelperAccess`) — least privilege.
  A Helper sees only the connectors/folders/skills it's been granted.
- Browser connector: Chromium headless (Playwright) under omilo's control, **one profile per
  agent**, screenshots streamed to the Job thread as `RunEvent(kind=browser)`.
- All tool calls are RLS-scoped by the token's `company_id`; cross-tenant access is
  impossible at the DB layer.

## 5. Where MCP runs

- The MCP server is part of `omilo-api` but called by the **worker** during a Job turn (the
  engine makes tool calls that hit the MCP endpoint with the Helper's token).
- Third-party MCP servers (pasted URL/package, or a marketplace `type:mcp` piece like Repliz) run
  **mounted/sandboxed** with egress controls; their tools appear alongside native ones but are
  always `ask` until the operator trusts them.

> **This doc is Role 2** of three MCP roles (omilo as server to its *own* agents). omilo is also
> an MCP **client** consuming connectors (Role 1), and — designed, built later — an MCP **server
> to external clients** like Claude Desktop (Role 3), which reuses this same per-agent server
> behind an externally-minted `McpAccessToken`. Full picture + the `omilo-pieces` marketplace:
> [`11-marketplace-connectors-mcp.md`](11-marketplace-connectors-mcp.md).

## 6. Why one-endpoint-per-agent (reuse)

- Clean authz: the bearer token *is* the identity + scope + autonomy; no ambient trust.
- Per-agent audit and rate-limits fall out naturally.
- Matches omilo-os exactly, so the proven tool contracts (`propose`/`get_approved`/`recall`/…)
  port directly.

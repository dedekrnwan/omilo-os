# In-chat permissions + force-stop — Design

**Date:** 2026-10-18
**Status:** Draft for approval (no code until approved)

## Intent

Two gaps in the Workspace chat:

1. When a helper needs access it does not have (a folder, a command, a connector, a skill), the
   owner has to leave the chat and grant it on the Computer / Connectors / Skills page. The
   helper cannot ask in context, and the owner cannot approve in one tap. The screenshot case:
   the Chief of Staff is blocked ("Bash is denied... I need you to allow Bash or Write on the
   target path") with no way to say yes from the chat.
2. A running chat turn cannot be stopped. The owner has no control once a helper starts.

This design lets a helper **ask for access inline in the chat**, the owner **approve or deny in
one tap**, and the owner **force-stop a running turn** at any time.

## Decisions (settled)

- Requestable in chat: **folders/computer access, connectors, and skills**.
- Each request offers **Allow once** (just this chat/task) and **Always allow** (persisted).
- A running turn has a **Stop** control that actually interrupts it.

## Feature A: in-chat permission requests

### The agent side

A new MCP tool, `request_access`:

```
request_access(kind, target, reason, task_id?)
  kind    = "folder" | "connector" | "skill"
  target  = folder: {path, access: "read"|"write", commands: bool}
            connector: {id}
            skill: {slug}
  reason  = one line the owner sees ("to copy skills into ~/.claude/skills")
```

It returns `granted` (once the owner approves) or `denied`, so the helper's blocked step can
continue or stop cleanly. For a blocking need the helper waits on the answer, the same way
`ask_founder(blocking=true)` already works.

### The owner side (inline card)

The gateway posts a **permission card** into the current thread, reusing the message `blocks`
mechanism that `offer_choices` already uses to render inline buttons. The card shows the helper,
what it wants (path + access + whether commands, or the connector/skill name), and the reason,
with three actions:

- **Allow once** — grant for this chat/task only.
- **Always allow** — persist the grant.
- **Deny** — refuse, with the reason recorded as a lesson (same as rejecting a proposal).

The card is also mirrored into the **Inbox** (an approval item) so it is never lost if the owner
is not looking at the chat; deciding in either place resolves both.

### What "grant" does, per kind

| kind | Allow once | Always allow |
| --- | --- | --- |
| folder | add the path to this task's one-off allowed set (like the existing `allow_connectors` for execution tasks), with the requested access/commands | create or update a `Folder` row (`path`, `access`, `commands`, `default_on`) |
| connector | add `connector.<id>` to this task's one-off allowed set (the mechanism that already exists) | set the `Connector` to "use directly" (or enable it) |
| skill | enable the skill for this thread (`ThreadTools`) | mark the skill "standard" (on everywhere) |

The engine picks up the grant on its next step: for Claude Code, a newly allowed folder is
passed with `--add-dir` and the matching Edit/Write/Bash permissions; one-off grants live for
the duration of the task, persisted grants are read on every run.

### Safety

- The hard denials stay enforced even when commands are allowed on a folder: `rm`, `sudo`,
  `git push`, publish, deploy, `ssh` still require a separate ask. Approving a folder with
  commands is not a blank check.
- Every grant writes an audit event (who approved, what, once vs always).
- Strict mode is unchanged: this is about granting *capabilities* a helper may use, not about
  auto-approving outward actions (posting, sending, spending still go through the normal gate).

## Feature B: force-stop a running turn

### The control

A **Stop** button on the live "Working" card in the Workspace, visible only while a turn runs.
Stopping keeps whatever partial output exists and ends the turn as **stopped** (distinct from
failed), with a short note in the thread.

### Making stop actually interrupt

Today `POST /api/tasks/{tid}/cancel` only marks the task cancelled in the database; the engine
subprocess keeps running until it finishes. The fix:

- The worker tracks its in-flight tasks by id. Cancel **cancels the running asyncio task**, which
  raises `CancelledError` in the run loop; the engine's existing teardown kills the subprocess
  (`proc.kill()` is already there on loop exit).
- Because the worker can be a separate process (server mode), the cancel request publishes a
  **Redis signal** (`omilo:cancel:<task_id>`); whichever worker holds the task cancels it. In
  laptop/embedded mode the worker is in-process and can cancel directly; the Redis path covers
  both.
- The turn ends with `status = "stopped"`, partial output preserved, usage metered up to the
  stop.

## Reuse (not rebuilt)

- Inline clickable UI: the message `blocks` used by `offer_choices`.
- Approval plumbing: proposals / Inbox items / `decide`.
- One-off grants: the execution-task `allow_connectors` pattern, extended to folders and skills.
- Persisted grants: `Folder`, `Connector`, `ThreadTools`, skill "standard" flag.
- Cancel endpoint and the engine's subprocess kill path.

## Risks and mitigations

- **Granting Bash on a path is powerful.** Mitigation: the hard command denials stay; the card
  states exactly what is being allowed; everything is audited; "Allow once" is the default-safe
  choice presented first.
- **Cross-process stop not reaching the worker** → Redis cancel signal, tested in both embedded
  and separate-worker modes.
- **A stop that leaves a half-written file or partial post** → stop ends the turn as "stopped"
  and keeps partial output visible; it does not execute any pending approved action.
- **Duplicate decisions (chat card + Inbox)** → both point at one approval record; deciding one
  closes the other.

## Non-goals (v1)

- Auto-approving outward actions (unchanged: posting/sending/spending still ask).
- A full permissions manager in chat (revoking is still done on the Capabilities pages).
- Granting access to another company's resources (single-company scope, as today).

## Verification

- A helper calls `request_access` for a folder with commands; the card appears in chat and in the
  Inbox; **Allow once** unblocks the helper for that task only; **Always allow** adds a `Folder`
  row that persists across runs; **Deny** records a lesson. Same for a connector and a skill.
- The hard denials still block `rm`/`git push` after a folder+commands grant.
- Stop on a live turn kills the engine subprocess within a second or two, ends the turn as
  "stopped" with partial output, in both embedded-worker and separate-worker setups.
- Audit log shows each grant and each stop with the actor.

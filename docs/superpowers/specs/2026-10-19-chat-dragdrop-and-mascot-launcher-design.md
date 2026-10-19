# Chat drag-and-drop + floating mascot launcher — Design

**Date:** 2026-10-19
**Status:** Awaiting approval

## Intent & why

Two gaps in today's chat:

1. **You can't drag files in.** Attaching a screenshot means opening the "+" menu and
   using a file picker (`ComposerTools.tsx`). People expect to drag a stack of photos
   straight onto the chat. We want that — with a playful moment where the Omilo mascot
   "catches" the dropped files, so the app feels alive and on-brand rather than
   generic.

2. **Chat is trapped on the `/chat/` page.** If you're on Workflows, Team, or Docs and
   want a quick word with the Chief of Staff, you have to navigate away. We want a
   floating mascot button in the bottom-right of **every** page that pops open a drawer
   with your most recent chat — with the *same* capabilities as the full workspace chat
   (messages, streaming replies, clickable choices, access requests, file attach, and
   the new drag-and-drop), minus the big progress/output/browser side panel.

The unifying move is to **extract the thread view (conversation + composer) into one
reusable component** so the full page and the drawer render the identical chat and can
never drift apart.

## Decisions made with the user

- **Drag-over visual: "Full catch" (option A).** On drag-over, the chat surface dims and
  the mascot pops to the center with file tiles tumbling down into it and a "Drop — I've
  got them!" hint. A dashed ring frames the drop zone. After drop, files land as the
  existing chips above the input (no change to the post-drop flow).
- **Launcher appears everywhere in the app** — bottom-right, Intercom-style, on every
  non-bare page (including `/chat/`; see anti-goals for the one caveat).
- **Drawer opens to the most recent session** — the thread with the newest `updated_at`.
  A row of recent sessions lets you hop between them without leaving the drawer.
- **Drawer depth: chat only, no side panel** — full conversation + composer + drag-drop,
  but drop the Progress/Output/Browser panel so it fits the ~400px drawer. An expand
  (⤢) control jumps to the full `/chat/?thread=<id>` page for the panel.
- **Launcher is truly everywhere, with a nudged position** — it shows on every page
  *including* `/chat/`, but shifted up/left there (and on phones) so it clears the
  composer's Send button and the side-panel toggle. We accept some crowding on small chat
  screens as the cost of being always-reachable.

## Calls made by the author (settling builder questions)

These were resolved without the user and are called out so they can be checked:

- **Reuse vs. the existing `ChatPane`.** `Conversation.tsx` already has a `ChatPane` — a
  *lite* self-contained drawer chat (load/poll/send only; no files, slash, mentions,
  access decide, or stop). That's the lightweight depth the user rejected. So the new
  launcher drawer uses the new full `ChatThread` (below), **not** `ChatPane`. `ChatPane`
  stays untouched for its existing task-drawer callers (a narrower, task-scoped use). A
  later cleanup could re-base `ChatPane` on `ChatThread`; out of scope here.
- **`ChatThread` is a *controlled* component.** The parent owns the active `threadId` and
  passes navigation callbacks. The page keeps syncing `threadId` ↔ the `?thread=` URL
  (deep-linking, auto-open of General stay as-is); the drawer holds its own `threadId`
  state for in-place session switching. This keeps page behavior byte-for-byte unchanged
  while letting the drawer switch sessions without touching the URL.
- **Default session = most recent thread *that has messages*, falling back to the Chief of
  Staff (`scope:"master"`).** Avoids opening to an empty auto-created General thread or a
  stale DM, and honors the intro's "quick word with the Chief of Staff."
- **Zero-threads / empty state.** If there's no recent session with messages, the drawer
  opens/creates the Chief of Staff (`master`) thread; if even that can't load, it shows a
  simple empty state rather than a blank panel.
- **Unread badge rides the existing `overview` poll.** Shell already polls `/overview`
  every 30s via `useOverview()`. The badge reads an unread/awaiting signal from there if
  one exists; only if none does, fall back to deriving it from the threads the page/drawer
  already load — no new always-on app-wide poller.

## Goals

- Drag one or many files/photos onto the chat (page **and** drawer) and have them upload
  via the existing path (`POST /files`, 25 MB cap, 10-file cap), shown as chips.
- The "full catch" mascot animation on drag-over, reusing the existing `Avatar`/mascot
  visual language and tokens.
- A floating mascot launcher on every page, with an unread indicator.
- A chat drawer that is the same chat component as the page, defaulting to the most
  recent session, with a recent-session switcher and an expand-to-full-page control.
- One reusable `ChatThread` component shared by the page and the drawer.

## Non-goals

- No change to the backend API (threads, messages, files, access, tools all unchanged).
- No redesign of the message rendering (`Conversation.tsx`) or the "+" tools menu
  itself — only additive drag-and-drop.
- The drawer does **not** include the Progress/Output/Browser side panel, the Chat/Work
  toggle, or the "Work" (tasks) view. Those stay on the full page.
- No new mascot asset pipeline — reuse the SVG mascot system already in `Avatar.tsx`.

## Anti-goals (what would make this a failure)

- Two diverging chat implementations (drawer logic drifting from page logic). If we
  copy-paste the composer/send logic instead of extracting it, this has failed.
- The launcher obscuring the composer's Send button or the existing side-panel toggle on
  the `/chat/` page, or covering content on mobile. It must never sit on top of an
  interactive control.
- Drag-and-drop hijacking normal drags (text selection, dragging a link) or firing when
  no files are present in the drag.
- The "full catch" overlay eating clicks or trapping focus when you're *not* dragging.

## Current state (what we build on)

- **Composer + upload:** `apps/web/components/ComposerTools.tsx` — owns `files`/`setFiles`,
  the hidden `<input type=file multiple>`, and `pick(list)` which base64-encodes and
  `POST`s each file to `/files` (25 MB/file, 10/batch). The "+" menu lives here.
- **Thread view:** `apps/web/app/chat/page.tsx` → `WorkspaceInner` holds *all* the chat
  state and logic: thread polling (`usePoll`, 1.5s while awaiting / 12s idle, ETag 304),
  `text`/`files`, `send`, slash (`useSlash`), mentions (`useMentions`), `decide` (access
  requests), stop, auto-scroll, and renders `<Conversation>` + the `.ws-composer` form.
- **Message rendering:** `apps/web/components/Conversation.tsx` —
  `<Conversation th staff events onSend busy onDecide />`. Reused as-is.
- **Drawer shell:** `apps/web/components/Drawer.tsx` + `.drawer`/`.scrim` CSS
  (fixed right, ESC to close, body scroll-lock, focus first field).
- **App frame / mount point:** `apps/web/components/Shell.tsx` wraps every non-bare page
  and already mounts always-on hosts (`NotifyHost`, `TaskDrawerLazy`, `ContextMenuHost`)
  and exposes `useOverview()`. The launcher mounts here.
- **Mascot:** `apps/web/components/Avatar.tsx` (shapes/colors/props incl. `crown`;
  `is_chief` staff = Chief of Staff). `scope: "master"` thread is the Chief of Staff
  conversation.
- **Styling:** custom CSS variables in `apps/web/app/globals.css` (no Tailwind).
- **Thread sort:** `Thread` has `updated_at`; "most recent" = max `updated_at`.

## The build (how)

### 1. Extract a reusable `ChatThread` component

New `apps/web/components/ChatThread.tsx`. Move the thread-scoped logic out of
`WorkspaceInner` into it:

- **Props:** `{ threadId: string | null; staff: Staff[]; inDrawer?: boolean;
  onExpand?: () => void }`.
- **Owns:** current thread polling, `text`/`files`, `send`, slash, mentions, `decide`,
  stop, auto-scroll, and renders `<Conversation>` + the `.ws-composer` form + `<PoolMeter>`
  + `<Err>` + the new drag-drop overlay (section 3).
- `WorkspaceInner` keeps the list sidebar, Chat/Work toggle, side `Panel`, and job views,
  and renders `<ChatThread>` where the `.ws-main` conversation+composer block is today
  (page.tsx:340–378). The page passes its already-loaded `staff` and an `onExpand` that's
  a no-op (already full-page).
- `inDrawer` tweaks: hide nothing essential, but slash actions that navigate
  (`go`, `router.push`) should either operate on the drawer's own session switch or route
  to the full page — **builder's call**, see open items.

This is the core refactor. Behavior on the full page must be byte-for-byte unchanged.

### 2. Share the upload logic

Extract the upload path from `ComposerTools` into a small shared helper/hook, e.g.
`useFileUpload(files, setFiles)` returning `{ upload(list), uploading, err }`, so both
the "+" menu's `pick` and the new drop overlay call the same code (same 25 MB / 10-file
caps, same `/files` POST). `ComposerTools` refactors to consume it; no behavior change.

### 3. Drag-and-drop "full catch" overlay

A `DropZone` inside `ChatThread` wrapping the conversation+composer surface:

- `onDragEnter`/`onDragOver`: only activate when the drag carries files
  (`e.dataTransfer.types.includes("Files")`); `preventDefault` so the browser doesn't
  navigate. Track a drag-depth counter to avoid flicker on child enter/leave.
- While active: render the overlay — surface dims (`rgba` scrim + slight blur), a dashed
  ring frames the zone, the mascot (Chief look, from `Avatar`) sits centered and bobs,
  three file tiles tumble in on a loop, with "Drop — I've got them!".
- `onDrop`: `preventDefault`, read `e.dataTransfer.files`, call `upload(files)`, clear the
  active state. Files appear as the usual chips.
- When inactive the overlay is unmounted/`pointer-events:none` so it never eats clicks or
  focus. New CSS lives in `globals.css` (reuse tokens; animations: bob, tumble/floatdown,
  dashed-ring pulse). Respect `prefers-reduced-motion` (static overlay, no looping anim).

### 4. Floating mascot launcher

New `apps/web/components/ChatLauncher.tsx`, mounted in `Shell.tsx` alongside the other
hosts (only when `ready && !bare`):

- Fixed bottom-right (`z-index` below modals/scrims but above page content; must clear the
  `.ws-composer` and side-panel toggle on `/chat/` — position/offset is the builder's call,
  with the anti-goal as the constraint).
- Round button showing the Chief of Staff mascot (crown), with an **unread badge**.
  - Badge source — **builder's call, my default:** count of threads with
    `awaiting_reply` from `/threads` (cheap, already polled by other views). If a truer
    "unread messages" signal exists on `overview`, prefer it. Log the choice.
- Click toggles the `ChatSessionsDrawer`. Optional idle hint bubble ("2 updates from your
  team") when the badge > 0 — nice-to-have, builder may defer.

### 5. Chat sessions drawer

New `apps/web/components/ChatSessionsDrawer.tsx`:

- Reuses the `.drawer` + `.scrim` shell styling and the ESC-to-close / body-scroll-lock
  behavior from `Drawer.tsx`. Because a chat needs a composer pinned to the bottom and a
  session-switcher row (not `Drawer`'s title/body/footer + auto-focus-first-input shape),
  this is a **dedicated component that mirrors `Drawer`'s shell**, not a wrapping of
  `Drawer.tsx`. (My call — keeps `Drawer.tsx` focused on form drawers.)
- On open: fetch `/threads` and `/staff`; pick the most recent (`max updated_at`) as the
  active session.
- **Header:** mascot + active session label (`Chief of Staff` / staff name / `# group`) +
  expand (⤢ → `router.push("/chat/?thread=<id>")` then close) + close (✕).
- **Session switcher:** horizontal chips of recent threads sorted by `updated_at` desc,
  active one highlighted; click switches the active session in place.
- **Body:** `<ChatThread threadId={active} staff={staff} inDrawer onExpand={…} />` — the
  same component as the page (section 1), so it inherits messages, streaming, choices,
  access requests, attach, and drag-drop automatically.

## What's left to the builder

- Exact z-index / offset of the nudged launcher on `/chat/` and mobile so it clears the
  composer Send button and the side-panel toggle (position only — it *does* render there).
- Confirming the `overview` unread signal exists; if not, the fallback derivation above.
- How `inDrawer` slash/navigation actions behave (operate on the drawer's session switch
  vs. route to the full page).
- Whether the idle hint bubble ships in v1.
- Animation timing/easing for the catch effect; `prefers-reduced-motion` fallback.
- Test coverage following the repo's existing patterns.

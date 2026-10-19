# Chat drag-and-drop + floating mascot launcher — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add drag-and-drop file upload with a "mascot catches the files" animation to the chat, and an app-wide floating mascot launcher that opens a drawer running the full chat against the most recent session.

**Architecture:** Extract the page's thread view (conversation + composer + all send/slash/mention/access/stop logic) into one *controlled* `ChatThread` component used by both the `/chat/` page and a new `ChatSessionsDrawer`. A `DropCatcher` wrapper adds the drag-over overlay and feeds files through a shared `useFileUpload` hook. A `ChatLauncher` mounts in `Shell` on every page and toggles the drawer.

**Tech Stack:** Next 15 / React 19, TypeScript, custom CSS variables in `globals.css` (no Tailwind), existing `api()` helper + `usePoll`/`useEvents` hooks. Reuses `Avatar`, `Conversation`, `Drawer`-style shell.

**Spec:** `docs/superpowers/specs/2026-10-19-chat-dragdrop-and-mascot-launcher-design.md`

## Global Constraints

- **No backend changes.** Threads, messages, files, access, tools APIs are unchanged.
- **No new test framework.** The repo has none; verification is `npm run lint` (`tsc --noEmit`, run from `apps/web`) plus the manual browser checks each task lists. Do not add vitest/jest/playwright.
- **Upload limits stay exact:** 25 MB per file, 10 files per batch, base64 → `POST /files`.
- **Follow existing CSS token style** in `apps/web/app/globals.css` (`--surface`, `--ink`, `--muted`, `--r-lg`, etc.); no inline hardcoded palette where a token exists.
- **Page behavior must stay byte-for-byte unchanged** after the `ChatThread` extraction.
- All new components are `"use client"`.

## Review Focus

Inputs the spec implies but no happy-path step exercises, most likely to bite first. Each has a manual check added to the owning task (no unit harness exists):

- **Dragging non-file content** (selected text, a link, an image from another tab) must NOT trigger the catch overlay — guard on `dataTransfer.types.includes("Files")`. (Task 3)
- **Drop while a reply is streaming** (`awaiting_reply`): files should still attach to the composer, not throw or get lost. (Task 3)
- **Over-cap drop** (a file > 25 MB, or > 10 files at once): same error/truncation behavior as the "+" picker. (Task 1)
- **Launcher overlapping the composer Send button** on `/chat/` and on phones: must be nudged clear, never on top of an interactive control. (Task 5)
- **Drawer opened with no session that has messages** (fresh account / only empty auto-created General): fall back to the Chief of Staff thread, show an empty state, never a blank panel. (Task 4)

---

## File Structure

- Create `apps/web/lib/upload.ts` — `useFileUpload` hook (shared upload path).
- Modify `apps/web/components/ComposerTools.tsx` — consume `useFileUpload`; drop its private `pick`/`toB64`.
- Create `apps/web/components/DropCatcher.tsx` — drag-over "full catch" overlay wrapper.
- Create `apps/web/components/ChatThread.tsx` — controlled full chat (conversation + composer + DropCatcher).
- Modify `apps/web/app/chat/page.tsx` — render `<ChatThread>` in place of the inline conversation+composer block.
- Create `apps/web/components/ChatSessionsDrawer.tsx` — right drawer: session switcher + `ChatThread`.
- Create `apps/web/components/ChatLauncher.tsx` — floating mascot button + unread badge.
- Modify `apps/web/components/Shell.tsx` — mount `<ChatLauncher>` with the other always-on hosts.
- Modify `apps/web/app/globals.css` — styles for drop overlay, launcher, drawer, session switcher.
- Modify `.gitignore` — add `.superpowers/`.

---

### Task 1: Shared `useFileUpload` hook

**Files:**
- Create: `apps/web/lib/upload.ts`
- Modify: `apps/web/components/ComposerTools.tsx:13-18` (remove `toB64`), `:63-76` (remove `pick`), and the two call sites `:133,:144` / state `:50-51`.
- Test: none (no harness) — manual check below.

**Interfaces:**
- Consumes: `api`, `BASE` from `@/lib/api`; `Attached` type from `@/components/ComposerTools`.
- Produces:
  ```ts
  export function useFileUpload(
    files: Attached[],
    setFiles: (f: Attached[]) => void,
  ): { upload: (list: FileList | File[] | null) => Promise<void>; uploading: boolean; err: string | null };
  ```
  `upload` keeps the exact current logic: `slice(0, 10)`, reject `> 25 * 1024 * 1024` with `` `${f.name} is larger than 25 MB` ``, base64 via a `FileReader` `readAsDataURL` (strip the `data:...,` prefix), `POST /files` each, append to `files`.

- [ ] **Step 1: Create `useFileUpload` in `apps/web/lib/upload.ts`**

Move `toB64` and the body of `pick` (ComposerTools.tsx:63-76) into the hook. `upload` accepts `FileList | File[] | null` (so a drop's `File[]` works too); internally `Array.from(list)`. Expose `uploading` and `err` as state.

- [ ] **Step 2: Refactor `ComposerTools` to use the hook**

Replace local `uploading`/`err` state and `pick` with `const { upload, uploading, err } = useFileUpload(files, setFiles);`. The `<input onChange>` calls `upload(e.target.files)` then clears `input.current.value`. Remove the now-unused `toB64`. Keep everything else (menu, badges, chips) identical.

- [ ] **Step 3: Verify types**

Run: `cd apps/web && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual check (happy path + over-cap)**

Run `npm run dev`, open a chat, use "+" → Add files or photos: a normal file uploads and shows a chip; a file > 25 MB shows the "larger than 25 MB" error; selecting > 10 files uploads only the first 10. (Review Focus: over-cap.)

- [ ] **Step 5: Commit**

```bash
git add apps/web/lib/upload.ts apps/web/components/ComposerTools.tsx
git commit -m "refactor: extract useFileUpload hook from ComposerTools"
```

---

### Task 2: Extract controlled `ChatThread` from the page

Pure move — no new behavior. Carves the thread-scoped logic out of `WorkspaceInner` (page.tsx:178-233, 252-267, 275-280, 340-378) into a reusable component.

**Files:**
- Create: `apps/web/components/ChatThread.tsx`
- Modify: `apps/web/app/chat/page.tsx` (remove the moved logic; render `<ChatThread>`)
- Test: none — manual regression below.

**Interfaces:**
- Consumes: `useFileUpload` (Task 1); `Conversation`, `AccessRequest`, `Choices`, `FullThread`, `Msg`, `useQuote` from `@/components/Conversation`; `ComposerTools`, `Attached`; `MentionBox`/`MentionHandle`; `useSlash`/`SlashAction`; `useMentions`; `PoolMeter`; `Err`; `Staff`, `Thread`, `api`; `usePoll`/`kick`; `RunEvent` from `@/components/Run`.
- Produces:
  ```ts
  export default function ChatThread(props: {
    threadId: string;
    staff: Staff[];
    events: RunEvent[];                 // caller owns the useEvents subscription
    inDrawer?: boolean;                 // reserved for drawer-only tweaks
    onThread?: (th: FullThread | null) => void;   // report loaded/updated thread up
    onStartJob?: (brief: string) => void;         // "/job" send → caller creates task + navigates
    onOpenThread?: (body: Record<string, string>) => void; // slash "talk" → open another thread
    onNavigate?: (href: string) => void;          // slash "go" → route
    onExpand?: () => void;              // drawer expand button (unused on page)
  }): JSX.Element;
  ```

**What moves into `ChatThread`** (owns all of it): the thread poll (page.tsx:200-207, keyed on `threadId`, 1.5s while `awaiting_reply` else 12s, ETag 304 behavior unchanged); `current` state (reported via `onThread`); `text`/`files` state; `useQuote`; `send` (252-267 incl. the `/job` branch → `onStartJob`); `useSlash`+`onSlash` (225-235) with `go`→`onNavigate`, `talk`→`onOpenThread`, `pause`/`composer`/`insert`/`job` as today; `useMentions`; `decide` (252-257); the `Stop` button + `stopping` state; auto-scroll (213); and the whole `.ws-scroll`+`.ws-composer` JSX (340-378) minus the Work-view branches.

**What stays in the page:** thread/task/staff lists + their poll; URL sync (`go`, `openThread`, auto-open General at 196); `useEvents` subscription (passed in as `events`); the side `Panel`; the Work view; the topbar. The page keeps a `current` state set via `onThread` for its topbar title and `output`/`lastAgentText` panel.

- [ ] **Step 1: Create `ChatThread.tsx`** with the signature above; move the logic listed. The composer JSX renders `<Conversation th={current} staff={staff} events={events} onSend={send} busy={current.awaiting_reply} onDecide={decide} />` inside `.ws-scroll`, and the `.ws-composer` form below (MentionBox, ComposerTools, Stop, Send). Render nothing (a small "Loading…" like today) until `current` loads.

- [ ] **Step 2: Wire the page to `ChatThread`** — replace page.tsx:340-378's chat branch with `<ChatThread threadId={tid} staff={staff} events={threadEvents} onThread={setCurrent} onStartJob={startJob} onOpenThread={openThread} onNavigate={(h)=>router.push(h)} onExpand={()=>{}} />`. Remove the now-duplicated thread poll, `send`, slash/mention/decide/stop/scroll that moved. Keep `current` as state updated only by `onThread`. The Work view is untouched.

- [ ] **Step 3: Verify types**

Run: `cd apps/web && npm run lint`
Expected: no errors.

- [ ] **Step 4: Manual regression on `/chat/`** — confirm unchanged: switching threads, sending a message, streaming reply + Stop, `@`-mentions, `/` slash menu (including `/job`, `/brief`), clickable choices, an access request Allow/Deny, attaching a file via "+", the side panel still updating, topbar title still correct.

- [ ] **Step 5: Commit**

```bash
git add apps/web/components/ChatThread.tsx apps/web/app/chat/page.tsx
git commit -m "refactor: extract controlled ChatThread component"
```

---

### Task 3: Drag-and-drop "full catch" overlay

**Files:**
- Create: `apps/web/components/DropCatcher.tsx`
- Modify: `apps/web/components/ChatThread.tsx` (wrap its surface), `apps/web/app/globals.css` (overlay styles)
- Test: none — manual checks below.

**Interfaces:**
- Consumes: `useFileUpload` (Task 1); `Avatar` from `@/components/Avatar` (mascot, Chief look).
- Produces:
  ```ts
  export default function DropCatcher(props: {
    onFiles: (files: File[]) => void;   // ChatThread passes upload
    disabled?: boolean;                 // never block; still accept drops while awaiting
    chief?: Staff;                      // mascot look
    children: React.ReactNode;
  }): JSX.Element;
  ```

- [ ] **Step 1: Create `DropCatcher`** — a wrapper `<div>` with drag handlers. Activate only for files; use a depth counter to avoid child flicker:

```tsx
const [active, setActive] = useState(false);
const depth = useRef(0);
const hasFiles = (e: React.DragEvent) => Array.from(e.dataTransfer.types).includes("Files");
const onDragEnter = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current++; setActive(true); };
const onDragOver  = (e) => { if (hasFiles(e)) e.preventDefault(); };
const onDragLeave = (e) => { if (!hasFiles(e)) return; depth.current--; if (depth.current <= 0) { depth.current = 0; setActive(false); } };
const onDrop = (e) => { if (!hasFiles(e)) return; e.preventDefault(); depth.current = 0; setActive(false); onFiles(Array.from(e.dataTransfer.files)); };
```

When `active`, render an overlay child (dashed ring + dimmed scrim + centered `<Avatar who={chief} size={64} />` that bobs + three tumbling file tiles + "Drop — I've got them!"). When not active, the overlay is not rendered (so it never eats clicks/focus). Respect reduced motion: gate the bob/tumble animations behind `@media (prefers-reduced-motion: no-preference)`.

- [ ] **Step 2: Add CSS to `globals.css`** — classes `.dropcatch` (position: relative wrapper), `.dropcatch-overlay` (absolute inset, scrim + blur, z above composer within the surface, `pointer-events:none` on the layer, centered flex), `.dropcatch-ring` (dashed, `--info`/accent, pulse), `.dropcatch-tile`, and keyframes `dc-bob`, `dc-tumble`, `dc-pulse`. Use existing tokens.

- [ ] **Step 3: Wrap the ChatThread surface** — in `ChatThread`, wrap the `.ws-scroll`+`.ws-composer` region in `<DropCatcher onFiles={upload} chief={chief} disabled={current?.awaiting_reply}>`. Add `useFileUpload(files, setFiles)` in ChatThread so the drop and the "+" menu share `files`/`setFiles`. `chief = staff.find(s => s.is_chief)`.

- [ ] **Step 4: Verify types**

Run: `cd apps/web && npm run lint`
Expected: no errors.

- [ ] **Step 5: Manual checks (incl. Review Focus)** — on `/chat/`: drag a few images from the OS → overlay catches, drop → chips appear and send works; **select text and drag it** → no overlay (files-only guard); **drag during a streaming reply** → files still attach; dropping a > 25 MB file → same error as picker; verify reduced-motion (OS setting) shows a static overlay.

- [ ] **Step 6: Commit**

```bash
git add apps/web/components/DropCatcher.tsx apps/web/components/ChatThread.tsx apps/web/app/globals.css
git commit -m "feat(chat): drag-and-drop with mascot catch overlay"
```

---

### Task 4: Chat sessions drawer

**Files:**
- Create: `apps/web/components/ChatSessionsDrawer.tsx`
- Modify: `apps/web/app/globals.css` (drawer + session-switcher styles)
- Test: none — manual checks below.

**Interfaces:**
- Consumes: `ChatThread` (Task 2); `Avatar`; `useEvents`; `api`, `Thread`, `FullThread`, `Staff`; `useRouter`; the `.drawer`/`.scrim` shell pattern + ESC/scroll-lock from `Drawer.tsx:15-24` (mirror it, do not wrap `Drawer`).
- Produces:
  ```ts
  export default function ChatSessionsDrawer(props: {
    open: boolean;
    onClose: () => void;
  }): JSX.Element | null;
  ```

- [ ] **Step 1: Create `ChatSessionsDrawer`** — when `open`: fetch `/threads` and `/staff`. Pick the active session: **most recent `updated_at` among threads that have messages**, else the Chief of Staff thread (`api<Thread>("/threads", { body: { scope: "master" } })`), else an empty state. Hold `activeId` in state. Render a scrim + `<aside className="drawer dw chat-drawer">` with ESC-to-close and body scroll-lock (mirror `Drawer.tsx`).

- [ ] **Step 2: Header + session switcher** — header: `<Avatar>` + active thread label (reuse the `threadLabel` logic: `master`→"Chief of Staff", `staff`→name, `group`→`# title`) + expand button (`router.push(\`/chat/?thread=${activeId}\`)` then `onClose`) + close. Below it a horizontal `.chat-switch` row of recent threads (sorted `updated_at` desc), active chip highlighted; clicking sets `activeId`.

- [ ] **Step 3: Body renders `ChatThread`** — `const events = useEvents(activeId ? { thread_id: activeId } : null);` then `<ChatThread threadId={activeId} staff={staff} events={events} inDrawer onThread={updateActiveLabel} onOpenThread={switchSession} onNavigate={(h)=>{router.push(h); onClose();}} onStartJob={(b)=>{router.push("/chat/?view=work"); onClose();}} onExpand={expand} />`. `onOpenThread` resolves the thread via `api("/threads",{body})` then sets `activeId` (in-place switch). `onThread` updates the header label.

- [ ] **Step 4: Add CSS** — `.chat-drawer` (flex column; body fills; composer pinned bottom), `.chat-switch` (horizontal scroll chip row), `.chat-chip`/`.chat-chip.on`. Reuse tokens.

- [ ] **Step 5: Verify types**

Run: `cd apps/web && npm run lint`
Expected: no errors.

- [ ] **Step 6: Manual checks** — temporarily mount the drawer open (e.g. a throwaway button) and confirm: opens to the most recent chat with messages; the switcher hops between sessions in place; sending, slash, mentions, choices, access requests, attach, and drag-drop all work inside the drawer; expand jumps to `/chat/?thread=...`; **with no message-bearing thread it lands on Chief of Staff / shows an empty state, never blank** (Review Focus). Remove the throwaway button before commit.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ChatSessionsDrawer.tsx apps/web/app/globals.css
git commit -m "feat(chat): reusable chat sessions drawer"
```

---

### Task 5: Floating mascot launcher + Shell mount

**Files:**
- Create: `apps/web/components/ChatLauncher.tsx`
- Modify: `apps/web/components/Shell.tsx:122-128` (mount), `apps/web/app/globals.css` (launcher styles), `.gitignore`
- Test: none — manual checks below.

**Interfaces:**
- Consumes: `ChatSessionsDrawer` (Task 4); `Avatar`; `useOverview` from `@/components/Shell`; `Staff`, `Thread`, `api` as needed.
- Produces:
  ```ts
  export default function ChatLauncher(): JSX.Element;
  ```

- [ ] **Step 1: Create `ChatLauncher`** — fixed bottom-right round button showing the Chief of Staff mascot (`<Avatar who={chief} />`, crown). Local `open` state toggles `<ChatSessionsDrawer open={open} onClose={...} />`. Unread badge: read an unread/awaiting signal from `useOverview()`; **if `overview` exposes none, fall back** to deriving a count from `/threads` where `awaiting_reply` (reuse, don't add a fast poller). Badge hidden when 0.

- [ ] **Step 2: Mount in `Shell`** — add `{ready && !bare && <ChatLauncher />}` beside `NotifyHost`/`TaskDrawerLazy` (Shell.tsx:126-127). It therefore renders on every page including `/chat/`.

- [ ] **Step 3: Add CSS + position nudge** — `.chat-launcher` fixed `right`/`bottom` with a comfortable offset, `z-index` above page content but below `.scrim`/modals. **On `/chat/` and on narrow/mobile widths, nudge it up/left** so it clears the `.ws-composer` Send button, the side-panel toggle, and the `.mobilebar` — e.g. a `body:has(.ws)` or media-query override raising `bottom`. The launcher still renders there (per spec); it must never sit on an interactive control. (Review Focus.)

- [ ] **Step 4: Add `.superpowers/` to `.gitignore`.**

- [ ] **Step 5: Verify types + build**

Run: `cd apps/web && npm run lint && npm run build`
Expected: both succeed.

- [ ] **Step 6: Manual checks (incl. Review Focus)** — on several pages (Inbox, Workflows, Team, Docs): the launcher shows bottom-right, badge reflects waiting chats, clicking opens the drawer to the most recent chat; on `/chat/` and at a phone width the launcher does **not** overlap the Send button or panel toggle; the scrim/ESC closes the drawer.

- [ ] **Step 7: Commit**

```bash
git add apps/web/components/ChatLauncher.tsx apps/web/components/Shell.tsx apps/web/app/globals.css .gitignore
git commit -m "feat(chat): app-wide floating mascot launcher"
```

---

## Self-Review notes

- **Spec coverage:** drag-drop full-catch → Task 3; app-wide launcher → Task 5; most-recent-with-fallback drawer + switcher + expand → Task 4; chat-only-no-panel via shared `ChatThread` → Task 2; shared upload path → Task 1; launcher nudge on `/chat`/mobile → Task 5; `.superpowers` gitignore → Task 5. The author-calls (ChatPane left as-is, controlled component, overview-based badge) are reflected in the task interfaces.
- **Review Focus:** each of the five lines has a manual check in its owning task (no unit harness exists in the repo).
- **Type consistency:** `ChatThread` props and the callback names (`onThread`, `onOpenThread`, `onStartJob`, `onNavigate`, `onExpand`) are identical in Tasks 2 and 4; `useFileUpload(files, setFiles)` signature identical in Tasks 1 and 3.

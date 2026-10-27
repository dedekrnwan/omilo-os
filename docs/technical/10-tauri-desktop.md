# 10 · Tauri Desktop & Web Shell

> Track: **technical**. One React frontend, two deliveries: a **Tauri desktop app (macOS)**
> and a **website**. This doc covers what Tauri adds beyond the web build and how it talks to
> the cloud backend. The backend is identical for both; the desktop shell only adds native
> capabilities.

## 1. Shape

- **Shared frontend.** The existing `src/` SPA is the single codebase. The web build is served
  as static assets; the desktop build wraps the same assets in a Tauri (Rust) webview.
- **Thin shell.** Current `src-tauri/` is a near-empty webview container with
  `bundle.active = false`. This TRD turns it into a real app but keeps business logic on the
  server — Tauri adds **native concerns only**, never agent execution.
- **Server-authoritative.** Agents/routines run in the cloud worker; closing the desktop app
  never stops work (see [`00`](00-architecture.md)). Desktop is a superior *client*, not a
  local backend.

## 2. What desktop adds over web

| Capability | Web | Desktop (Tauri) |
|---|---|---|
| Secure credential storage | httpOnly cookie | **OS keychain** (macOS Keychain) for refresh token |
| Native notifications | Web Push (browser) | **native notifications** + Dock badge |
| Deep links / protocol | URL | `omilo://` deep links (approve from a notification) |
| Launch at login / background | — | optional menu-bar presence, stays signed in |
| Local MCP bridge (optional) | — | expose the user's **own machine** (local files, local model) to their agents |
| Auto-update | browser refresh | Tauri updater (signed releases) |
| Offline read | limited | cache last-synced reads; writes queue until online |

## 3. Auth on desktop

- Sign-in uses the same `/v1/auth/*` endpoints. The **refresh token** is stored in the macOS
  Keychain via Tauri's secure store (not localStorage); the short-lived access JWT lives in
  memory.
- OAuth/SSO and connector OAuth use the system browser with an `omilo://` redirect back into
  the app (deep link), avoiding embedded-webview auth pitfalls.
- A Rust command (`#[tauri::command]`) brokers token read/write so the webview JS never holds
  the long-lived secret at rest.

## 4. Notifications & deep links

- The backend's Web Push `{title, body, url, tag, level}` is delivered to desktop and rendered
  as a **native notification**; clicking routes via `omilo://inbox/{id}` deep link straight to
  the decision — the operator can **Approve** without opening the full app first.
- Dock/menu-bar badge reflects the count of `needs_you` InboxItems (from the SSE
  `inbox.*`/`notice.created` stream).

## 5. Local MCP bridge (optional, powerful)

The onboarding "self-host / already signed in on this computer" path (`AI_MODES.self-host`,
e.g. "Claude Code 2.1.169 signed in on this computer") implies the desktop app can lend the
**user's local machine** to their cloud agents:
- A Tauri-hosted **local MCP server** exposes granted local folders and the locally-installed
  model/CLI (Claude Code / Ollama / LM Studio) as connector tools.
- The cloud worker reaches it through an authenticated tunnel (outbound from the desktop;
  no inbound ports) — only while the app is running, clearly scoped and revocable.
- This is how "runs on this computer with the AI you already have" works without moving the
  user's login off their machine. Strictly opt-in; absent it, agents use cloud credits / pool.

## 6. Networking & config

- Base API URL is build-config (`VITE_API_URL`); desktop points at the cloud (or a self-host
  URL). The `Repos` HTTP adapter + SSE/WS clients are transport-identical to web.
- CORS/CSRF: web uses SameSite cookies + CSRF tokens on mutations; desktop uses bearer tokens
  from the keychain (no cookie/CSRF concern).
- The existing `src/app/push.ts` TODO (`route through Tauri invoke under desktop`) is realized
  here: push registration and notification display branch on `isTauri()`.

## 7. Packaging & release

- `tauri.conf.json`: enable `bundle.active`, macOS signing + notarization, the updater
  (signed, with a release feed), and the `omilo://` URL scheme. Universal binary (arm64 +
  x86_64).
- CI builds web (static) and desktop (dmg) from the same commit; version parity enforced.
- **Windows** is out of scope for v1 (macOS + web only, per the stated target) but the Tauri
  shell keeps it a later config change, not a rewrite.

## 8. Non-goals

- No agent execution, scheduler, or DB on the desktop — the local MCP bridge is the only local
  compute, and it's just a tool surface.
- No divergent frontend code beyond a small `platform` adapter (`isTauri()` branches for
  storage, notifications, deep links).

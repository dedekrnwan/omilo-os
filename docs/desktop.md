# Omilo for macOS

One app with everything inside it. Download the `.dmg`, drag Omilo to Applications, open it. There's no Docker,
database or terminal to set up. The first start takes about a minute while it sets up the office's database. After
that it opens in a few seconds.

## What's inside

| Part | What it does | Where it lives in the app |
| --- | --- | --- |
| The app (Tauri, Rust) | window, menu bar icon, notifications, Dock badge, start/stop | `Contents/MacOS/Omilo` |
| Python 3.12 + Omilo | the office: API, web app, worker | `Contents/Resources/runtime/python` |
| Postgres 17 + pgvector | everything Omilo knows, including the knowledge base | `runtime/pgsql` |
| Valkey 8 | live updates, locks and queues (Redis-compatible, BSD licence) | `runtime/valkey` |
| Node.js 22 | runs Claude Code for the helpers (installed from Settings) | `runtime/node` |
| The web app | the screens | `runtime/web` |

At start, the app runs `python -m omilo_api.desktop` (`apps/api/omilo_api/desktop.py`). This launcher:

1. On the first start, creates the database with a generated password and turns on pgvector.
2. Starts Postgres and Valkey on free ports, reachable only from this Mac (127.0.0.1), with passwords.
3. Runs Omilo with the worker inside it, on `http://127.0.0.1:7700` (or the next free port), then tells the app
   it's ready.
4. When the app quits or crashes, shuts everything down cleanly. Postgres gets a proper shutdown, so no data is
   lost.

Closing the window keeps Omilo running in the menu bar, so helpers keep working on schedules and replies. To stop
everything, use **Quit Omilo** (⌘Q, or from the menu bar icon).

## Your data

Everything lives in `~/Library/Application Support/Omilo`:

```
postgres/      the database (keep this folder to keep your office)
valkey/        live state (safe to lose)
omilo/         files, knowledge-base documents, the encryption key, installed Claude Code
logs/          omilo.log, postgres.log, valkey.log
desktop.json   ports and generated passwords (private to you)
```

The menu bar icon has **Show Data Folder** and **Show Logs**. To back up, quit Omilo and copy the folder. To start
over, quit and move the folder away.

This is separate from a Docker or `make dev` install (those use `~/.omilo` and their own database), so both can
exist on one Mac. The app picks another port if 7700 is taken.

## Helpers and your tools

Helpers run on Claude Code. The app looks for the `claude` command in your normal Terminal setup (`~/.local/bin`,
Homebrew, npm). If you don't have it, **Harness → Install Claude Code** (or the setup step in onboarding) installs it using the Node.js that comes
with the app. `git` comes with the Xcode Command Line Tools: macOS offers to install them the first time something
needs them.

## Build it

On a Mac (Apple Silicon or Intel, each builds for itself) you need: the Xcode Command Line Tools
(`xcode-select --install`), Rust ([rustup.rs](https://rustup.rs)), [uv](https://docs.astral.sh/uv/) and Node 22.

```bash
make desktop            # builds dist/runtime, then Omilo.app and the .dmg
open apps/desktop/src-tauri/target/release/bundle/dmg
```

The first build compiles Postgres and Valkey from source (a few minutes). Downloads are cached in `dist/cache`.

To build only one part again: `ONLY=python scripts/desktop/build-runtime.sh` (or `postgres`, `valkey`, `node`,
`web`). `make desktop` builds the runtime only the first time; `make desktop-runtime` rebuilds it (after changing `apps/api`) and `make desktop-app` rebuilds just the app. `make desktop-dev` runs the app against `dist/runtime` without packaging it.

### In GitHub Actions

`.github/workflows/desktop.yml` builds both `.dmg` files (Apple Silicon and Intel) when you run it by hand, and
publishes them as a release when you push a tag like `desktop-v0.4.0`. It also starts the bundled office once as a
smoke test.

### Signing

Without an Apple Developer ID the app is signed ad hoc. It works, but macOS refuses to open it the first time.
Right-click Omilo → **Open**, or go to System Settings → Privacy & Security → **Open Anyway**. If you built it
yourself on your own Mac, it opens normally.

To sign and notarize (no warning for anyone), add these repository secrets: `APPLE_CERTIFICATE` (your Developer ID
Application `.p12`, base64), `APPLE_CERTIFICATE_PASSWORD`, `APPLE_SIGNING_IDENTITY` (`Developer ID Application:
Name (TEAMID)`), `APPLE_ID`, `APPLE_PASSWORD` (an app-specific password) and `APPLE_TEAM_ID`. Locally, set
`APPLE_SIGNING_IDENTITY` before `make desktop`.

## Size

About 650 MB installed (the `.dmg` is smaller). Most of it is Python packages, LiteLLM alone is about 140 MB.
`PRELOAD_EMBEDDINGS=1` adds the knowledge-base model (~220 MB) so search works offline from the first minute.
Without it, the model downloads on first use.

## Not yet

- **Updates.** For now, install a new `.dmg` over the old one; your data stays. In-app updates (Tauri updater with
  GitHub Releases) come next.
- **Windows and Linux.** The launcher and the shell already work there. Only the runtime build and packaging are
  macOS-only.
- **Clicking a notification** brings Omilo to the front but doesn't open that item yet. The Inbox shows it.

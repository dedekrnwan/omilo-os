# 10a · Desktop Release Runbook (macOS)

> Companion to [10 · Tauri Desktop & Web Shell](10-tauri-desktop.md).  
> This doc covers **everything you need to ship a signed, notarized macOS `.dmg`** from the
> `omilo-v2` repo. Windows is out of scope for v1 — the Tauri config keeps it a later addition,
> not a rewrite.

---

## 0. Prerequisites

| Tool | Version | Where |
|---|---|---|
| Rust / Cargo | ≥ 1.77.2 | `rustup update stable` |
| Tauri CLI | 2.x | `bun add -D @tauri-apps/cli` (already in `devDependencies`) |
| Bun | any recent | build frontend |
| Xcode + Command Line Tools | latest | required for `codesign`, `xcrun notarytool`, `stapler` |

---

## 1. Tauri updater keypair

The Tauri updater uses **asymmetric signing** (Minisign / Ed25519). The private key signs each
release artifact; the public key is embedded in `tauri.conf.json` so the running app can verify
updates.

### Generate once (do this locally; store securely)

```bash
# Run from any working directory
npx tauri signer generate -w ~/.tauri/omilo.key
```

This outputs:
- **Private key** → `~/.tauri/omilo.key`  (NEVER commit; store in CI secrets)
- **Public key** → printed to stdout, e.g. `dW50cnVzdGVkIGNvbW1lbnQ6...`

### Store the private key + password

In your CI environment (GitHub Actions / GitLab CI / similar) add two secrets:

| Secret name | Value |
|---|---|
| `TAURI_SIGNING_PRIVATE_KEY` | contents of `~/.tauri/omilo.key` |
| `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` | the password you entered during keygen (can be empty string `""`) |

**Never commit these values.** The `.key` file and any raw key material must stay out of version
control — add `*.key` to `.gitignore` if not already covered by the root `.gitignore`.

### Embed the public key

Replace the `TODO` placeholder in `tauri.conf.json`:

```jsonc
// src-tauri/tauri.conf.json
"plugins": {
  "updater": {
    "active": true,
    "endpoints": ["https://releases.omilo.app/{{target}}/{{arch}}/{{current_version}}"],
    "pubkey": "<paste the public key string printed by tauri signer generate>"
  }
}
```

The public key is **not secret** — it is safe (and required) to commit it.

---

## 2. Apple signing: Developer ID Application certificate

### Obtain the certificate

1. Sign in to [developer.apple.com](https://developer.apple.com) with the team Apple ID.
2. **Certificates, IDs & Profiles → Certificates → +**.
3. Choose **Developer ID Application** (for distributing outside the Mac App Store).
4. Generate a CSR from Keychain Access, upload it, and download the resulting `.cer`.
5. Double-click the `.cer` to install it into your **login keychain**.

### Set `signingIdentity` in tauri.conf.json

```jsonc
"bundle": {
  "macOS": {
    "signingIdentity": "Developer ID Application: Your Name or Org (TEAM_ID)",
    "providerShortName": "TEAM_ID",
    "minimumSystemVersion": "11.0",
    "category": "public.app-category.productivity"
  }
}
```

Find the exact string with:

```bash
security find-identity -v -p codesigning
```

Copy the full `"Developer ID Application: …"` string including the 10-character team ID in
parentheses.

### Hardened runtime entitlements

Tauri 2 enables the hardened runtime automatically during `tauri build`. If you need additional
entitlements (e.g. for the Keychain access used by `tauri-plugin-keychain` / `keyring`), place
them in `src-tauri/Entitlements.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN"
  "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>com.apple.security.app-sandbox</key>
  <false/>
  <key>com.apple.security.network.client</key>
  <true/>
  <key>keychain-access-groups</key>
  <array>
    <string>$(AppIdentifierPrefix)dev.omilo.app</string>
  </array>
</dict>
</plist>
```

Point to it in `tauri.conf.json`:

```jsonc
"bundle": {
  "macOS": {
    "entitlements": "Entitlements.plist"
  }
}
```

---

## 3. Notarization

Apple requires notarization for all Developer ID-signed apps distributed outside the Mac App
Store (macOS 10.15+). Tauri 2 can run notarization automatically during build if you supply the
right environment variables.

### One-time: create an App-Specific Password

1. Sign in to [appleid.apple.com](https://appleid.apple.com).
2. **Sign-In and Security → App-Specific Passwords → +**.
3. Label it "Tauri notarytool" and copy the generated password.

### Store notarization credentials in CI

| Secret name | Value |
|---|---|
| `APPLE_ID` | your Apple ID email |
| `APPLE_ID_PASSWORD` | the app-specific password |
| `APPLE_TEAM_ID` | your 10-character team ID |

Tauri 2 reads these env vars automatically during `tauri build --target universal-apple-darwin`.

### Manual notarization (if needed)

```bash
# 1. After tauri build, submit the dmg:
xcrun notarytool submit \
  src-tauri/target/release/bundle/dmg/Omilo_0.1.0_universal.dmg \
  --apple-id "$APPLE_ID" \
  --password "$APPLE_ID_PASSWORD" \
  --team-id "$APPLE_TEAM_ID" \
  --wait

# 2. Staple the ticket to the dmg so offline Gatekeeper accepts it:
xcrun stapler staple \
  src-tauri/target/release/bundle/dmg/Omilo_0.1.0_universal.dmg
```

`--wait` polls until notarization is complete (usually < 5 min). A `status: Accepted` response
means you are good. `stapler` embeds the Apple ticket into the artifact so it validates offline.

---

## 4. Build flow: web + dmg

```bash
# 1. Bump version (keep tauri.conf.json + package.json in sync — see §5).

# 2. Build the desktop artifact (signs + notarizes if env vars are set):
bun run build          # frontend: tsc + vite build → dist/
cargo tauri build      # or: bun run tauri:build

# For a universal binary (arm64 + x86_64):
cargo tauri build --target universal-apple-darwin
```

### Artifact locations

| Artifact | Path |
|---|---|
| `.app` bundle | `src-tauri/target/release/bundle/macos/Omilo.app` |
| `.dmg` installer | `src-tauri/target/release/bundle/dmg/Omilo_<version>_aarch64.dmg` |
| Universal `.dmg` | `src-tauri/target/universal-apple-darwin/release/bundle/dmg/Omilo_<version>_universal.dmg` |

The `.dmg` is what you distribute. Upload it to GitHub Releases (or your release CDN) and update
the updater endpoint to serve the new version JSON.

---

## 5. Version parity rule

`tauri.conf.json` and `package.json` **must carry the same version on every release commit.**
The CI gate enforces this with a simple script:

```bash
TAURI_VER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('src-tauri/tauri.conf.json','utf8')).version)")
PKG_VER=$(node -e "console.log(JSON.parse(require('fs').readFileSync('package.json','utf8')).version)")
if [ "$TAURI_VER" != "$PKG_VER" ]; then
  echo "Version mismatch: tauri.conf.json=$TAURI_VER, package.json=$PKG_VER"
  exit 1
fi
```

Bump both files in the same commit, tagged `v<version>`.

---

## 6. `omilo://` deep-link scheme

### How it is registered

The scheme is declared in two places (both already committed):

1. **`tauri.conf.json`** — `plugins.deep-link.desktop.schemes: ["omilo"]`  
   Tauri 2's `tauri-plugin-deep-link` reads this to register the scheme in the OS at install
   time (macOS: Info.plist `CFBundleURLTypes`).

2. **`src-tauri/src/lib.rs`** — `.plugin(tauri_plugin_deep_link::init())`  
   The plugin hooks the OS event and forwards deep-link URLs to registered Rust/JS listeners.

### Testing deep links

After installing the `.app` (or during dev with `bun run tauri:dev`):

```bash
# Open a deep link from the terminal:
open "omilo://inbox/some-id"

# Or from a browser address bar:
omilo://auth/callback?token=xxx
```

The app must be running; if it isn't, macOS will launch it. Watch the Tauri console for
`deep-link://` events; the JS side receives them via `@tauri-apps/plugin-deep-link`.

### Expected URL patterns

| Pattern | Purpose |
|---|---|
| `omilo://inbox/{id}` | Navigate to an InboxItem |
| `omilo://auth/callback?code=…` | OAuth/SSO redirect back into the app |
| `omilo://connector/callback?…` | Connector OAuth return |

The frontend parser in `src/platform/` validates the host and pathname before routing — unknown
patterns are silently dropped.

---

## 7. Updater plugin wiring (follow-up task)

The `plugins.updater` block is NOT yet in `tauri.conf.json` — it was intentionally omitted so
`cargo check` stays green without the `tauri-plugin-updater` crate. To activate in-app
auto-updates, add the config block alongside wiring the Rust plugin:

1. Add to `src-tauri/Cargo.toml`:
   ```toml
   tauri-plugin-updater = "2"
   ```

2. Add to `src-tauri/src/lib.rs`:
   ```rust
   .plugin(tauri_plugin_updater::Builder::new().build())
   ```

3. Add to `src-tauri/capabilities/default.json` `permissions`:
   ```json
   "updater:default"
   ```

4. Replace the `pubkey` placeholder in `tauri.conf.json` with the real public key (§1 above).

This was deferred from P5c-T3 to keep `cargo check` green without a live crates.io fetch.

---

## 8. Windows — out of scope for v1

The Tauri shell is cross-platform by nature; switching from `["dmg","app"]` to `["nsis","msi"]`
in `bundle.targets` is the primary config change. Signing on Windows requires an EV code-signing
certificate and Authenticode. This is a later config addition, not a rewrite.

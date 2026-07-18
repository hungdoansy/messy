# Messy — System Design

> How the app is put together: the shell/view split, the multi-account session
> model, and — most importantly — the origin trust boundary that lets a local
> UI safely host untrusted remote Messenger content.

Last reviewed against the code: 2026-07-18 (v1.4.0).

---

## 1. What Messy is

Messy is a **multi-account Facebook Messenger desktop client for macOS (Apple Silicon only)**, built on Electron 43. It is a macOS fork of `nct88/Messenger-Win` (forked at v1.3.0), substantially rewritten with a hardened security model.

Unlike an app that runs *your own* code (e.g. nodl), Messy's whole job is to embed **someone else's website** — `facebook.com/messages` — several times at once, keep each login isolated, and bolt native conveniences on top (tray, badges, PIN lock, download manager, "block seen/typing"). The defining engineering problem is therefore not computation but **containment**: the remote content is untrusted, actively changing, and must never gain access to the machine or to another account's session.

## 2. Repo shape

Deliberately flat — plain CommonJS, no bundler, no framework, no TypeScript. What ships is what's in the repo:

```
messy/
├── main.js          # Electron main process — everything privileged (~1400 lines)
├── trust.js         # Origin trust boundary (pure, unit-tested)
├── preload.js       # contextBridge for the shell window ONLY
├── index.html       # The shell UI (sidebars, modals, lock screen, CSP meta)
├── renderer.js      # Shell UI logic (profiles, lock screen, download panel)
├── custom_style.css # CSS injected INTO the Messenger views (hide banner etc.)
├── test/            # node --test suites (trust, changelog scripts)
├── build/entitlements.mac.plist
├── .github/
│   ├── workflows/release.yml       # arm64 build + GitHub Release
│   └── scripts/generate-changelog.js, prepend-changelog.js
└── docs/            # landing page (index.html) + plans/
```

Dependencies: exactly one runtime dep (`electron-updater`); dev deps are `electron` + `electron-builder`. The `package.json` `build` key holds the electron-builder config, including **Electron fuses** (see §4.6).

## 3. Process & view model

One BrowserWindow, two very different kinds of web content inside it:

```
┌───────────────────────────────────────────────────────────────────┐
│ BrowserWindow ("the shell")                                       │
│  loads local index.html — sandboxed, contextIsolation, preload.js │
│  renders: left sidebar (accounts) + right sidebar (toolbar),      │
│           modals, PIN lock screen, download panel                 │
│                                                                   │
│   ┌───────────────────────────────────────────────┐               │
│   │ WebContentsView  (one per account, layered    │               │
│   │ over the shell, x-offset 52px, right 42px)    │               │
│   │  loads https://www.facebook.com/messages      │               │
│   │  partition: persist:nick_<profileId>          │               │
│   │  NO preload · NO Node · sandbox: true         │               │
│   └───────────────────────────────────────────────┘               │
└───────────────────────────────────────────────────────────────────┘
         main.js owns: window, tray, views, sessions, IPC,
         downloads, updater, settings, PIN hashing
```

- **The shell** (`index.html` + `renderer.js`) is the only trusted web content. It gets the preload bridge (`window.messy`) and nothing else — no `require`, no `ipcRenderer`, `sandbox: true`.
- **Each account is a `WebContentsView`** (the modern replacement for the deprecated `BrowserView`), created lazily on first switch, kept alive after that, and swapped in/out of `mainWindow.contentView` by `showView()`. At most one is attached at a time; the sidebar UI stays visible because the view is bounded to leave 52px/42px gutters.
- **Per-account isolation is Chromium's, not ours**: each view gets `partition: "persist:nick_<id>"`, which gives it a completely separate cookie jar, cache, localStorage, IndexedDB, and service workers. Two logged-in accounts can't see each other by construction.
- Views are resized on window resize/maximize/fullscreen (`updateBrowserViewBounds`), hidden while shell modals or the lock screen are up (`set-browserview-visibility`), and destroyed + recreated with a wiped session on logout.

## 4. The trust model (the heart of the app)

The design assumes Messenger content is **hostile**: it can redirect, open windows, name downloads, and its DOM is attacker-influenceable. Defenses are layered so no single mistake is fatal.

### 4.1 Origin allowlists (`trust.js`)

A tiny, dependency-free, unit-tested module — deliberately the *only* place origin decisions live. Two separate allowlists with different scopes:

- `isTrusted(url)` — top-level navigation trust for Messenger views: `https:` only, parsed `URL().hostname` matched against exact hosts (`facebook.com`, `www./m.facebook.com`, `messenger.com`, `www.messenger.com`) or `*.facebook.com` / `*.messenger.com` / `*.fbcdn.net` suffixes.
- `isAllowedPopupHost(url)` — OAuth login popups only: exactly `accounts.google.com` and `appleid.apple.com`.

The file's header comment states the rule the whole app follows: substring checks like `url.includes("facebook.com")` are bypassable (`evil.com/facebook.com`, `facebook.com.evil.com`) and are never used — always parse, then match the hostname.

Keeping the two lists separate matters: OAuth hosts may open a popup, but they must **never** widen what the main Messenger view is allowed to navigate to.

### 4.2 Navigation & window-open guards (`setupWebContents` in main.js)

For every Messenger view:

- `setWindowOpenHandler`: trusted URLs open in-place; allowed OAuth hosts open as a **sandboxed popup window** (no preload, no Node); everything else is denied and handed to `safeOpenExternal()` — which itself re-validates the scheme (`https/http/mailto` only, so `file:`, `javascript:`, custom schemes, and UNC paths can never reach the OS handler).
- `will-navigate` + `will-redirect`: blocked unless `isTrusted(url)` — deny-by-default against redirect-based escapes.
- **Popups are guarded recursively** via `did-create-window`: a popup gets the same window-open handler and nav guards, except its allowed set is `isTrusted ∪ isAllowedPopupHost` (it legitimately bounces between provider and Facebook).
- **OAuth round-trip detection**: the popup is only auto-closed when it has *first* visited a provider host and *then* returned to a trusted Facebook/Messenger URL (`visitedOAuth` flag) — at which point the parent view reloads (now logged in) and the popup closes. The flag prevents closing on an incidental early Facebook navigation.

### 4.3 The shell/view privilege split

- Messenger views: **no preload at all** — there is nothing to reach; even a full renderer compromise finds no bridge to main. IPC guards are thus defense-in-depth, not the first line.
- Shell window: `preload.js` exposes a **channel-allowlisted, function-per-action API** (`window.messy`). It never exposes `ipcRenderer`, never forwards the raw event object, and never carries secrets (PIN hashing lives in main; `getSettings` deliberately returns a filtered subset without `appLockHash`).
- Main-side, sensitive IPC channels re-check the sender: `isShellSender(event)` requires `event.sender === mainWindow.webContents` before honoring `applock:*`, `open-external`, and download-open calls.

### 4.4 Content-Security-Policy on the shell

Two layers, same policy: a `<meta>` CSP in `index.html` and an `onHeadersReceived` injection on the **default session only** (Messenger partitions are intentionally untouched). Key line: `script-src 'self' file:` with no `unsafe-inline` — injected inline handlers or `<script>` can't execute even if untrusted data were ever rendered as HTML. The renderer additionally builds all dynamic DOM (filenames, toasts) with `textContent`/`createElement`, never `innerHTML` for data (the only `innerHTML` uses are constant SVG strings).

### 4.5 Renderer-supplied data is never trusted for filesystem paths

The download system (§6.4) is the clearest example: the renderer refers to downloads **by numeric id only**; main resolves the id to the path *it* wrote, re-validating containment in `~/Downloads` before `shell.openPath`. A renderer-supplied path is never accepted.

### 4.6 Packaging-level hardening

- **Electron fuses** (in `package.json`): `runAsNode: false`, NODE_OPTIONS and `--inspect` disabled, asar integrity validation on, `onlyLoadAppFromAsar: true` — the packaged binary can't be repurposed as a Node runtime or trivially patched.
- Hardened runtime with minimal entitlements (`allow-jit` + unsigned-exec-memory for V8, `network.client`) — no mic/camera/file entitlements.
- DevTools are blocked in packaged builds (F12/Cmd-Shift-I intercepted, `devtools-opened` → immediately closed); the same keys *open* DevTools in dev.
- Permission request/check handlers: only trusted origins may use notifications/media/clipboard; everything else is denied. (Note the request-handler allowlist includes mic/camera for calls — but the app's entitlements don't, so packaged builds can't actually grant them at the OS level.)

## 5. Multi-account lifecycle

**The profile list lives in the shell renderer's `localStorage`** (`mp_profiles`) — main holds no account registry; it only materializes views on demand. A profile is `{ id, name, avatar, partition }`.

| Flow | What happens |
|---|---|
| **Create** | Renderer generates `id` (crypto UUID), `partition = persist:nick_<id>`, asks main to `clear-new-profile-session` (wipes any stale storage for that partition name), saves to localStorage, switches to it. |
| **Switch** | `switch-profile` → main lazily creates the `WebContentsView` (partition, sandboxed, spoofed Chrome-on-macOS user agent), wires `setupWebContents`, loads Messenger, and swaps it in via `showView`. |
| **Logout** | Destroy the view → `clearStorageData` (cookies, localStorage, IndexedDB, service workers, …) + `clearCache` + `clearAuthCache` on the partition → recreate a fresh view → reply `logout-profile-done`. Account entry survives; session doesn't. |
| **Delete** | View destroyed; profile removed from localStorage (renderer enforces "at least 1 account"). Partition data on disk is not proactively wiped (it is on next reuse via create-flow clearing). |

The user agent is pinned to a desktop Chrome UA — Facebook serves the full Messenger web app rather than degrading the embedded Electron UA.

## 6. Feature mechanics

Messy has no API access to Messenger — every feature is built from the outside, via three levers: **network interception**, **script injection/polling**, and **CSS injection**.

### 6.1 Block "Seen" / "Typing" — webRequest interception

A single `onBeforeRequest` filter on every session (registered in the `app.on("session-created")` hook, so partition sessions get it automatically) watches `*.facebook.com` / `*.messenger.com` requests and cancels:

- Seen: legacy endpoints (`/change_read_status.php`) **and** GraphQL bodies containing markers like `LSThreadMarkRead`, `ThreadMarkReadMutation`, `"name":"mark_read"`.
- Typing: `/typ.php` endpoints and bodies containing `TypingIndicator` variants.

Toggled live from the tray menu (settings-gated per request — no re-registration needed). Inherently fragile against Facebook renames; the marker list is the maintenance surface.

### 6.2 Avatar + unread badges — executeJavaScript polling

Per view, two intervals scrape the page:

- **Avatar (5 s)**: looks for profile `<svg image>`/`<img>` elements pointing at `scontent`/`fbcdn` CDN URLs; falls back to reading the `c_user` cookie from the partition and building a `graph.facebook.com/<uid>/picture` URL. Sent to the shell, which persists it on the profile (only overwriting *auto-fetched* avatars — a user-picked local file wins).
- **Unread count (3 s)**: parses `(N)` from `document.title`, falling back to summing DOM badge nodes. The shell aggregates per-profile counts into sidebar badges, the dock badge, and the tray tooltip.

Both intervals self-clear when the view's webContents is destroyed.

### 6.3 De-chroming — custom_style.css

Injected into every view on `did-finish-load` via `insertCSS`. The load-bearing trick is overriding Facebook's own CSS variable `--header-height: 0px`, then hiding `[role=banner]`, `[role=progressbar]`, the footer, and scrollbars — so the embedded page looks like a native pane instead of a website.

### 6.4 Downloads

Main intercepts `will-download` on every session: the Content-Disposition filename is **attacker-controlled**, so it's reduced to a bare basename (`sanitizeDownloadName`), resolved under `~/Downloads`, and containment-checked (`containedInDownloads`) before `item.setSavePath`. Progress streams to the shell (`download-started/-progress/-done`), which renders a panel with per-file progress, cancel, and open-file/open-folder actions — all keyed by download **id**, resolved back to a validated path in main (§4.5).

### 6.5 App lock (PIN)

- **Hashing lives exclusively in main**: new PINs → `scrypt` with a per-install random 16-byte salt, stored as `scrypt$<salt>$<hash>` in settings; verification uses `crypto.timingSafeEqual`. Legacy sha256 hashes (from the upstream fork) still verify and are **transparently upgraded** to scrypt on the next successful unlock.
- Two brute-force throttles: an authoritative main-side cooldown (10 failures → 30 s lockout, checked in `applock:verify`) plus a cosmetic renderer-side 5-attempt/30 s keypad disable.
- The lock screen is shell UI; while locked, the Messenger view is detached (`setBrowserViewVisibility(false)`) so content isn't visible *or attached* behind the overlay. Auto-lock re-arms on an idle timer (configurable minutes, activity events reset it).
- PIN format is enforced main-side (`/^\d{4}$/`), and setup/verify/disable are all `isShellSender`-gated.

### 6.6 Native integration

Tray icon with context menu (reload, launch-at-login, minimize-to-tray, block-seen/typing toggles, update check, quit), dock badge, global show/hide hotkey (`Cmd+Shift+M`), always-on-top, native macOS menu (needed for Cmd+C/V to work inside views), single-instance lock, minimize-to-tray-on-close (window `close` is intercepted unless actually quitting).

## 7. Settings & the userData migration

`settings.json` in `userData` — one flat JSON object merged over `DEFAULT_SETTINGS` on load; every mutation calls `saveSettings` immediately. It holds window bounds, theme, tray/hotkey prefs, block flags, and the app-lock hash.

**Legacy migration** (the app was renamed twice: `Mosx`, `Messlỏ` → `Messy`): Electron derives the `userData` dir from the product name, so renaming would silently orphan every user's logins. On startup, if the new dir has no `settings.json`, the newest legacy dir *that contains one* is copied over — skipping disposable Chromium caches (a fixed skip-set) — and `settings.json` is copied **last** as the atomic completion marker: a crash mid-copy leaves no marker, so the migration retries next launch instead of being recorded as done. The old dir is kept as a rollback net. Best-effort: any failure → fresh defaults.

## 8. Updates & release pipeline

- **In-app**: `electron-updater` against GitHub Releases (`latest-mac.yml` + `.dmg` + blockmap). Checks 5 s after startup and on demand from the tray; `autoDownload: false` — the user confirms download and install via native dialogs. (Auto-update only actually works on signed builds.)
- **CI** (`.github/workflows/release.yml`): manual dispatch with a version input → validate semver + tag-collision check → `pnpm install --frozen-lockfile` → **run tests** → `npm version` → generate release notes with `generate-changelog.js` (commit subjects since the last `v*` tag, conventional-commit prefixes stripped, optionally rewritten into user-facing notes by the Gemini API — with a raw-bullet fallback so a missing key/failed call never fails the release) → build.
- **Signing is best-effort by design**: with `CSC_LINK`/notarization secrets present it produces a signed, notarized, auto-updatable build; without them it falls back to an **ad-hoc** build (runnable locally, not distributable) rather than failing. Locally, `electron-builder.env` pins `CSC_IDENTITY_AUTO_DISCOVERY=false` so `pnpm run build` works on machines without a Developer ID.
- The workflow commits the version bump + prepended `CHANGELOG.md` and pushes `main` + the tag (documented caveat: branch protection must allow the bot).
- The unsigned distribution reality is documented in the README: users must `xattr -cr` and right-click-open once (Gatekeeper).

## 9. Testing

`node --test` (zero test dependencies), targeting the pure seams on purpose:

- `test/trust.test.js` — the security-critical allowlists, including bypass shapes (`evil.com/facebook.com`, lookalike hosts, non-https).
- `test/generate-changelog.test.js`, `test/prepend-changelog.test.js` — the release-notes helpers (exported pure functions; requiring the module doesn't run the CLI flow).

The Electron-bound majority of `main.js` is not unit-tested; the tested surface is exactly the part where a silent regression would be a security hole (trust.js) or a broken release (changelog scripts). CI runs the suite before every release build.

## 10. Design decisions & trade-offs (summary)

| Decision | Why | Cost |
|---|---|---|
| `WebContentsView` per account over partition sessions | OS-grade isolation for free; one window, native-feeling swap | Views are memory-heavy; all created views stay alive until logout/delete |
| No preload in Messenger views | Compromised remote content finds *no* bridge — the strongest possible boundary | All features must work from outside: interception, polling, CSS |
| Centralized, pure `trust.js` | One reviewable, unit-testable place for the security boundary; parsed-hostname matching only | Adding a legit new host requires a code change (accepted — that's the point) |
| Feature-by-scraping (badges, avatars, block-seen) | No API exists; this is the only way | Fragile against Facebook DOM/endpoint churn; polling costs a little CPU |
| Profiles in shell `localStorage` | Simplest source of truth; main stays stateless about accounts | Clearing the shell's storage forgets accounts (sessions survive on disk, relinked only by partition name) |
| PIN hashing main-side, scrypt + legacy upgrade | Secrets never cross the bridge; upstream users keep working | Lock protects the *UI*, not the disk — partition data is not encrypted at rest |
| Flat plain-JS repo, no build step | The whole app is auditable in ~3.8k lines; ship-what-you-wrote | No types, no modules; `main.js` is a long single file |
| Sign-if-possible release pipeline | Releases never block on Apple paperwork | Unsigned builds need the documented Gatekeeper dance and get no auto-update |

## 11. Pointers into the code

| Concern | Where |
|---|---|
| Origin allowlists (both) | `trust.js` |
| Navigation/popup/OAuth guards | `main.js` → `setupWebContents()` |
| View create/swap/bounds | `main.js` → `showView()`, `updateBrowserViewBounds()`, `switch-profile` IPC |
| Session wipe (logout / new profile) | `main.js` → `logout-profile`, `clear-new-profile-session` IPC |
| Block seen/typing | `main.js` → `app.on("session-created")` webRequest filter |
| Avatar/badge scraping | `main.js` → `setupWebContents()` intervals |
| Download sanitization + id resolution | `main.js` → `sanitizeDownloadName`, `containedInDownloads`, `resolveDownloadPath` |
| PIN hashing/verify/throttle | `main.js` → `makePinHash`, `verifyPinHash`, `applock:*` handlers |
| userData migration | `main.js` → `migrateLegacyUserData()` |
| Shell bridge (full API surface) | `preload.js` |
| Shell UI (profiles, lock, downloads) | `renderer.js`, `index.html` |
| Messenger de-chroming CSS | `custom_style.css` |
| Fuses, entitlements, builder config | `package.json` (`build` key), `build/entitlements.mac.plist` |
| Release pipeline + notes generation | `.github/workflows/release.yml`, `.github/scripts/` |

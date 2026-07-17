---
title: "feat: Rebrand Mosx → Messy, translate app to English, record upstream & adopt OAuth fix"
type: feat
status: active
date: 2026-07-17
---

# feat: Rebrand Mosx → Messy, translate app to English, record upstream & adopt OAuth fix

## Overview

Four related changes to this macOS Electron Messenger app (currently branded "Mosx", v1.3.0):

1. **Rebrand** the app from `Mosx`/`mosx` to `Messy`/`messy` in every place it appears — including a **safe userData migration** so existing users keep their logged-in accounts and settings.
2. **Record the upstream repository** this project was forked from (`nct88/Messenger-Win`, since renamed to `nct88/MessengerMulti-Windows`) as durable attribution.
3. **Apply what's worth applying** from the upstream author's commits since the fork point — concretely, adopt the v1.4.0 Google/Apple OAuth login-popup fix, adapted to mosx's stricter security model.
4. **Translate all Vietnamese to English** — runtime UI strings, source-code comments, README, `package.json` description, and the `docs/` landing page.

## Problem Frame

The app was forked from a Vietnamese-language, Windows-targeted project and heavily rewritten for macOS with a hardened security posture (Electron 43, `WebContentsView`, strict origin allowlist). It still carries the interim "Mosx" branding and Vietnamese-language strings throughout. The owner wants a clean "Messy" identity, an all-English UI/codebase, proper provenance for the fork, and to selectively benefit from fixes the original author shipped after the fork diverged.

Because a build has already shipped (v1.3.0), the rename is not purely cosmetic: the Electron `userData` directory name is derived from the product name, so a naïve rename orphans every existing user's profiles, sessions, and settings. That risk drives the sequencing of this plan.

## Requirements Trace

- **R1.** Every occurrence of the name is renamed — **no exceptions** (owner directive). User-visible spots read "Messy" (window title, tray, lock screen, README, landing page); identifiers read "messy" (package `name`, appId, `window.messy` bridge, the PIN-salt constant, and the `publish` repo slug). The only survivors are external plan/CHANGELOG references and the historical name in the attribution section.
- **R2.** Existing users upgrading from v1.3.0 retain their profiles, sessions, and settings after the rename (no data loss).
- **R3.** The upstream repository origin is recorded durably in the project.
- **R4.** The fork-vs-upstream analysis is captured, and the one clearly-applicable upstream fix (Google/Apple OAuth login popups) is implemented and adapted to mosx's architecture.
- **R5.** No Vietnamese remains in runtime strings, comments, README, `package.json`, or `docs/`.
- **R6.** Security invariants are preserved — the OAuth change must not widen the top-level navigation trust boundary for the main Messenger view.

## Scope Boundaries

- **Rename applies everywhere, no exceptions** (owner directive): every `mosx`/`Mosx` string is renamed — including the `publish` repo slug and the legacy PIN-salt constant `_mosx_salt_2026`. Both carried real carve-out rationale (auto-update feed; legacy PIN verification); those consequences are now handled explicitly in Key Technical Decisions and Risks rather than avoided.
- **In scope (new):** renaming the GitHub repository `hungdoansy/mosx` → `hungdoansy/messy` so `publish.repo` can become "messy" (see Key Technical Decisions).
- **Not** regenerating icons — icons were just regenerated from Messenger source art (commit `b825cb3`) and carry no "Mosx" text.
- **Not** back-merging upstream git history — the branches diverged at v1.3.0 and mosx rewrote the runtime for macOS; upstream changes are ported by hand where applicable, not cherry-picked.
- **Survivors (not renamed):** references to the old name in external/historical context — this plan and prior plan docs, `CHANGELOG.md` history, and the README attribution line recording the fork origin.

### Deferred to Separate Tasks

- **Upstream v1.4.1 lock-screen "jank" fix**: mosx rewrote the App-Lock UI independently; reviewed, no clear defect to port. Revisit only if lock-screen flicker is observed: separate investigation.
- **Upstream v1.4.2 RCE-via-download-filename + popup-origin tightening**: already superseded by mosx's stronger `sanitizeDownloadName` + `containedInDownloads` + strict `isTrusted` allowlist. No action; noted for parity verification only.

## Context & Research

### Fork & Upstream Analysis (R3, R4)

- **Shared history / fork point:** both repos share commits through `7af750e` (**v1.3.0**, "Session Isolation & Logout"). mosx diverged there to do the macOS + security rewrite; upstream continued on Windows.
- **Upstream (`nct88/MessengerMulti-Windows`, formerly `Messenger-Win`) commits since fork (7):**

  | Upstream commit | Summary | Applicable to mosx? |
  |---|---|---|
  | `7f3d56f` v1.3.1 | Donate URL bump | **No** — mosx removed donate entirely |
  | `9a0be17` | Portfolio links → truong.me | **No** — author-specific |
  | `6d7b4b6` **v1.4.0** | **Fix Google OAuth login (redirect_uri_mismatch) + OAuth popup support** | **YES — high value** (Unit 4) |
  | `f79c8ca` | Publish-repo rename | **No** — upstream-specific |
  | `39ed2fd` v1.4.1 | Fix donate tab + lock-screen jank | Donate part N/A; lock-jank part deferred (see above) |
  | `fed5379` v1.4.2 | Patch RCE via download filename + tighten login popup origin | **Already covered** by mosx's stronger hardening — parity-verify only |
  | `8e5c0a6` v1.4.3 | Remove auto-open donate | **No** — mosx already removed donate |

- **Why the OAuth fix matters for mosx:** mosx's `ALLOWED_HOSTS` (main.js:148) trusts only `facebook.com`, `messenger.com`, `fbcdn.net`. Any "Continue with Google/Apple" login opens a popup to `accounts.google.com` / `appleid.apple.com`, which mosx's `setWindowOpenHandler` (main.js:528) treats as untrusted → opens it in the external browser → the OAuth flow can't complete in-session (session/partition not shared). Upstream's fix maintains a separate popup-only allowlist (`google.com`, `apple.com`) with session inheritance and auto-closes the popup when it redirects back to Facebook/Messenger.

### Relevant Code and Patterns

- **Name touchpoints (source):**
  - `package.json`: `name` "mosx", `build.productName` "Mosx", `build.appId` "com.mosx.app", `build.mac.artifactName` "Mosx-…", `description` (Vietnamese).
  - `main.js`: `APP_ID = "com.mosx.app"` (main.js:37), tray tooltip "Mosx" (main.js:227), unread tooltip (main.js:1194), header comment (main.js:2).
  - `preload.js`: `contextBridge.exposeInMainWorld("mosx", …)` (preload.js:24) + comments.
  - `renderer.js`: ~50 `mosx.*` bridge calls (renderer.js:176 onward) + header comments.
  - `index.html`: `<title>Mosx</title>` (index.html:9), lock-title "Mosx" (index.html:1196).
  - `README.md`, `docs/index.html`, `docs/style.css`, `docs/script.js`.
- **userData derivation:** `SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json")` (main.js:52), computed at module load. Electron derives `userData` from the app name (`productName`), so `~/Library/Application Support/Mosx/` today. Per-profile sessions live in partition folders under this same directory.
- **Security handlers to mirror for the OAuth unit:** `isTrusted` (main.js:156), `setupWebContents` window-open + `will-navigate`/`will-redirect`/`did-create-window` guards (main.js:524-557).
- **Vietnamese string surface:** main.js (~56 diacritic lines — tray menu, update dialogs, section-header comments), renderer.js (~38), index.html (~39 — UI labels), custom_style.css (4 comments), README.md (~38), `docs/` landing page.

### Institutional Learnings

- Project memory `framework-tauri-blocker` notes block-seen depends on `webRequest` POST-body inspection — unrelated here but confirms the block-seen/typing filters are load-bearing and must not regress during rebrand edits.

### External References

- Upstream repo (provenance): `https://github.com/nct88/MessengerMulti-Windows` (formerly `https://github.com/nct88/Messenger-Win`).

## Key Technical Decisions

- **Casing:** "Messy" for display/user-visible strings (window title, tray, lock, README H1, landing page); "messy" for lowercase identifiers (`package.json` `name`, appId slug). Chosen by owner.
- **appId → `com.messy.app` WITH first-launch migration:** chosen by owner. Migration must move the old userData directory to the new one so accounts/settings survive (R2).
- **Migration keys on BOTH product name and appId:** the userData folder name follows `productName`, so renaming "Mosx"→"Messy" (independent of appId) is what actually moves `~/Library/Application Support/Mosx` → `…/Messy`. The migration copies from the old name-derived path if the new one doesn't yet exist.
- **Rename `_mosx_salt_2026` → `_messy_salt_2026` (main.js:94), no exception (owner directive) — confirmed risk-free at implementation:** git history shows this salt AND scrypt were both introduced in the same *unreleased* commit `dffa2f8`; the actually-shipped v1.2.0/v1.3.0 builds hashed in the renderer with salt `_messlo_salt_2026`. So no shipped build ever produced a hash keyed on `_mosx_salt_2026` — that legacy cohort is empty and the rename matches nothing real. The originally-planned "offer PIN re-setup on unlock failure" fallback is therefore **dropped**: it was unnecessary AND a security hole (any user could bypass the lock by deliberately failing). Net implementation = mechanical string rename only. (Pre-existing latent bug — real v1.3.0 PIN hashes use `_messlo_salt_2026` and aren't recognized by the current legacy path — is out of scope for this rebrand and flagged separately.)
- **Rename the `window.mosx` bridge → `window.messy`:** internal identifier (invisible to users); renaming is mechanical but must be done atomically across `preload.js` and `renderer.js`.
- **OAuth popup trust is popup-scoped, not navigation-scoped (R6):** add `google.com`/`apple.com` to a *separate popup allowlist* used only by `setWindowOpenHandler` for opening the login popup and by the popup's own child guards — NOT to `ALLOWED_HOSTS`/`isTrusted`, which continues to gate top-level navigation of the main Messenger view. This preserves mosx's hardened boundary while enabling third-party login.
- **Rename the GitHub repo `hungdoansy/mosx` → `hungdoansy/messy` and set `publish.repo` = "messy" (no exception):** GitHub preserves redirects for renamed repositories, so existing installed clients that poll `hungdoansy/mosx` for updates are transparently redirected to the new slug — the auto-update feed keeps working. The repo rename is a GitHub operation performed by the owner (outside the codebase); the `package.json` `publish.repo` and `artifactName` ("Messy-…") string changes land in the same commit. Verify an update check from an old build resolves post-rename.

## Open Questions

### Resolved During Planning

- Capitalization → "Messy"/"messy" (owner).
- appId migration → change + migrate on launch (owner).
- Translation scope → everything including comments (owner).
- OAuth fix → include, adapted to mosx (owner).
- Which upstream commits apply → only v1.4.0 (analysis above); all others N/A or already covered.

### Deferred to Implementation

- Exact old→new userData migration mechanism (rename vs. recursive copy) — depends on whether partition sub-directories contain OS-locked files at launch; decide against real dirs during implementation. Recommended default: recursive copy leaving the old dir intact as a rollback safety net, guarded so it runs once.
- Whether `APP_ID` const (main.js:37) is actually referenced at runtime (e.g., `setAppUserModelId`) or dead — confirm during edit; update it regardless for correctness.
- Final English phrasing for user-facing strings — copy decisions made during translation.

## Implementation Units

- [ ] **Unit 1: Rebrand identifiers and user-facing name (Mosx → Messy/messy)**

**Goal:** Replace **every** `mosx`/`Mosx` occurrence with the correct-cased new name across metadata, main process, preload/renderer bridge, shell HTML, the PIN-salt constant, and the publish target — no exceptions. (userData migration is Unit 2.)

**Requirements:** R1

**Dependencies:** None (but land alongside Unit 2 — changing `productName`/`appId` without Unit 2 causes data loss).

**Files:**
- Modify: `package.json` (`name`→"messy", `productName`→"Messy", `appId`→"com.messy.app", `artifactName`→"Messy-${version}-arm64.${ext}", `publish.repo`→"messy")
- Modify: `main.js` (`APP_ID`→"com.messy.app" main.js:37; **PIN salt `_mosx_salt_2026`→`_messy_salt_2026` main.js:94**; PIN verify fallback for unverifiable hashes; tray tooltip main.js:227; unread tooltip main.js:1194; header comment)
- Modify: `preload.js` (`exposeInMainWorld("messy", …)` preload.js:24 + comments)
- Modify: `renderer.js` (all `mosx.` → `messy.` bridge references; PIN re-setup path when unlock reports no verifiable hash)
- Modify: `index.html` (`<title>` index.html:9; lock-title index.html:1196)
- Modify: `README.md` (H1, image alt, DMG artifact path)
- External (owner): rename GitHub repo `hungdoansy/mosx` → `hungdoansy/messy`

**Approach:**
- Bridge rename must be atomic across `preload.js` + `renderer.js`; verify no string-literal channel names embed "mosx".
- Rename the legacy PIN salt. Because stored legacy hashes can't be re-derived, add a graceful fallback: when neither `legacyPinHash` (new salt) nor the scrypt hash matches at unlock, treat it as "no valid lock" and route the user to PIN re-setup rather than a hard lockout.
- Set `publish.repo` to "messy" in the same commit as the GitHub repo rename; rely on GitHub's rename redirect for existing clients.

**Patterns to follow:** existing `package.json` `build` block, `contextBridge` exposure shape, and the current `makePinHash`/`legacyPinHash`/unlock flow (main.js:91-99+).

**Test scenarios:**
- Happy path: launch app → window title, tray tooltip, and lock-screen title all read "Messy".
- Happy path: every renderer action through the bridge (switch profile, zoom, reload, lock) still works after `window.mosx`→`window.messy` rename (proves no missed reference).
- Happy path (PIN): set a new PIN on the renamed build → lock → unlock succeeds (scrypt path, unaffected by salt rename).
- Edge case (PIN): a stored *legacy* hash (computed with the old salt) no longer verifies → app offers PIN re-setup instead of locking the user out; after re-setup, unlock works.
- Edge case: grep the source tree for `mosx`/`Mosx` returns only the documented survivors (this plan / prior plan docs, `CHANGELOG.md`, README attribution line).
- Error path: renderer references an undefined `mosx.*` → surfaces as a console ReferenceError; confirm none remain.

**Verification:** App launches and is fully interactive under the new name; PIN lock works for new PINs and degrades gracefully for legacy ones; no `ReferenceError` in the renderer console; targeted grep shows only the documented survivors.

---

- [ ] **Unit 2: Migrate userData on first launch (preserve accounts & settings)**

**Goal:** On first launch under the new name/appId, move the existing user's profiles, sessions, and settings from the old userData directory to the new one so upgrading users lose nothing.

**Requirements:** R2

**Dependencies:** Unit 1 (defines the new name/appId that changes the userData path).

**Files:**
- Modify: `main.js` (early startup, before `SETTINGS_PATH` is computed at main.js:52)

**Approach:**
- Very early in `main.js` — before line 52 and before any `app.getPath("userData")` consumer — check a list of legacy product names newest-first and copy the first non-empty one. **Correction from git history:** the actually-shipped v1.2.0/v1.3.0 builds used productName **"Messlỏ"** (the "Mosx" productName was an unreleased dev build), so `LEGACY_NAMES = ["Mosx", "Messlỏ"]`. New path = `app.getPath("userData")` (now name-derived to "Messy").
- If the new directory does not exist (or is empty) **and** a legacy directory exists, recursively copy legacy → new (`fs.cpSync`). Guard so it runs exactly once (skip if `settings.json` or any content already exists in the new dir).
- Leave the old directory intact as a rollback safety net (documented, low disk cost).
- Confirm this runs before `let settings = loadSettings()` (main.js:200) so the first post-rename launch reads migrated settings.
- Also account for the single-instance lock (main.js:44) and macOS `appData` base path; the copy must complete before windows/sessions are created in `app.whenReady`.

**Execution note:** Add a characterization check first — capture the pre-rename userData path and contents against a throwaway profile, then assert they appear at the new path after migration.

**Test scenarios:**
- Happy path: seed `~/Library/Application Support/Mosx/settings.json` + a partition folder → launch renamed app → same settings/partitions present under `…/Messy/`; a logged-in profile stays logged in.
- Edge case: no old directory (fresh install) → app launches with defaults, no error, no empty-copy artifacts.
- Edge case: new directory already populated (second launch) → migration is skipped; no re-copy, no overwrite of newer data.
- Error path: old directory partially unreadable / a locked file → migration fails gracefully (logged, app still launches on defaults) rather than crashing at startup.
- Integration: settings written after migration persist to the new path (`saveSettings` main.js:79 targets `…/Messy/settings.json`).

**Verification:** A simulated upgrade (old dir seeded, new dir absent) results in a logged-in, correctly-configured app pointing at the new userData path; fresh installs and repeat launches are unaffected.

---

- [ ] **Unit 3: Translate all Vietnamese to English**

**Goal:** Replace every Vietnamese string with an English equivalent — runtime UI, dialogs, tray menu, comments, README, `package.json` description, and the `docs/` landing page.

**Requirements:** R5

**Dependencies:** None (parallel with Units 1–2; coordinate on shared files main.js/renderer.js/index.html to avoid churn conflicts — sequence after Unit 1's edits to those files).

**Files:**
- Modify: `main.js` (tray menu labels main.js:250-302, updater dialogs main.js:334-361, all section-header + inline comments)
- Modify: `renderer.js` (UI strings + comments)
- Modify: `index.html` (visible labels, placeholders, lock screen copy)
- Modify: `custom_style.css` (comments)
- Modify: `README.md` (full translation)
- Modify: `package.json` (`description`)
- Modify: `docs/index.html`, `docs/style.css`, `docs/script.js` (landing page copy + comments)

**Approach:**
- Translate meaning, not word-for-word; keep emoji and formatting in tray labels (e.g., "💬 Open Messenger", "🔄 Reload page", "🚀 Launch at login", "🛡️ Security", "❌ Quit").
- Updater dialog copy: preserve button semantics ("Download"/"Skip", "Not up to date"/"Up to date", "Install and Restart").
- Do not alter any non-Vietnamese identifiers, URLs, channel names, or the frozen PIN-salt string.
- Final pass: `grep -P '[À-ỹ]'` across source + docs returns nothing.

**Test scenarios:**
- Happy path: open the tray menu → every item is English; trigger "Check for updates" → dialog text and buttons are English.
- Happy path: open the app UI → all labels, placeholders, and the lock screen are English.
- Edge case: unread-count tray tooltip formats correctly in English (main.js:1194) for 0, 1, and many unread.
- Test expectation: comments/README/docs are non-runtime — verified by the diacritics grep returning empty, not by a runtime test.

**Verification:** Diacritics grep over `*.js`, `*.html`, `*.css`, `*.md`, and `docs/` is empty; tray menu, updater dialogs, and app UI render English at runtime.

---

- [ ] **Unit 4: Adopt upstream Google/Apple OAuth login popups (adapted to mosx)**

**Goal:** Let users log in via "Continue with Google/Apple" by allowing those OAuth popups in-session, without widening the main view's navigation trust boundary.

**Requirements:** R4, R6

**Dependencies:** None (independent of rename; touches `setupWebContents` in main.js).

**Files:**
- Modify: `main.js` (`setupWebContents` main.js:524-557; add popup-scoped allowlist + popup lifecycle handling)

**Approach:**
- Introduce a separate `ALLOWED_POPUP_HOSTS` set (`google.com`, `apple.com`, plus the existing Facebook/Messenger/fbcdn already trusted) used **only** inside `setWindowOpenHandler` to decide whether to open a login popup — distinct from `ALLOWED_HOSTS`/`isTrusted`, which continues to gate `will-navigate`/`will-redirect` on the main view.
- When a popup URL matches the popup allowlist, allow it with a small login-window size and `contextIsolation: true`, `nodeIntegration: false`, inheriting the parent view's session/partition (critical for OAuth to complete in the same account context).
- On `did-create-window`, watch the popup's navigations; when it returns to a Facebook/Messenger home URL (validated by parsed hostname, not substring), reload the parent Messenger view and close the popup.
- Keep the popup's own child-navigation guards so an OAuth popup can't be repurposed to navigate to an arbitrary origin.
- Mirror mosx's existing hostname-parse discipline (main.js:156) — no `url.includes()` substring checks.

**Execution note:** Start from a failing manual check — confirm "Continue with Google" currently opens in the external browser; then verify it opens and completes in-app after the change.

**Technical design:** *(directional guidance, not implementation spec)*
- `setWindowOpenHandler`: `isAllowedPopupHost(url)` → allow with login-window options + inherited session; else `safeOpenExternal(url)` + deny (unchanged default).
- `did-create-window` → on child `did-navigate` to a validated Facebook/Messenger home host → `contents.loadURL(MESSENGER_URL)` then close child.

**Patterns to follow:** existing `setupWebContents` guards (main.js:524-557), `isTrusted` hostname parsing (main.js:156), `safeOpenExternal` usage.

**Test scenarios:**
- Happy path: click "Continue with Google" → login popup opens **inside** the app (not the external browser), completes, popup closes, and the Messenger view reloads authenticated.
- Happy path: same for Apple Sign-In (`appleid.apple.com`).
- Edge case: popup redirects back to a Facebook home URL → popup auto-closes and parent reloads exactly once.
- Error path (security): a popup attempting to navigate to a non-allowlisted origin (e.g., `evil.com`) is still blocked / opened externally, and cannot navigate the child webContents there.
- Error path (security): main Messenger view `will-navigate` to `accounts.google.com` is still governed by `isTrusted` (popup allowlist must not leak into top-level nav trust).
- Integration: the popup shares the parent profile's partition, so the resulting login lands in the correct account and does not cross-contaminate other profiles.

**Verification:** Google and Apple logins complete in-app in the correct profile; non-allowlisted popup/navigation attempts remain blocked; `ALLOWED_HOSTS`/`isTrusted` behavior for the main view is unchanged.

---

- [ ] **Unit 5: Record upstream provenance / attribution**

**Goal:** Durably document the repository this project was forked from.

**Requirements:** R3

**Dependencies:** None (README already edited in Units 1/3 — sequence after them to avoid conflicts).

**Files:**
- Modify: `README.md` (add a "Credits / Upstream" section)

**Approach:**
- Add a short attribution section noting this is a macOS fork of `nct88/Messenger-Win` (now `nct88/MessengerMulti-Windows`), forked at v1.3.0, subsequently rewritten for macOS with a hardened security model. Link both URLs (old + renamed).
- Optional (owner's choice at implementation): add a local `upstream` git remote pointing at the renamed repo for future comparison — a developer convenience, not committed state. If done, note it in README's contributing/dev notes rather than relying on undocumented local config.

**Test scenarios:**
- Test expectation: none — documentation-only change. Verified by reading the rendered README section and confirming both upstream URLs resolve.

**Verification:** README contains an accurate, English attribution section with working links to the original and renamed upstream repositories.

## System-Wide Impact

- **Interaction graph:** Unit 1's bridge rename touches every `renderer.js` → `preload.js` call path; Unit 4 touches the per-view `setupWebContents` wiring applied to every profile's `WebContentsView`.
- **State lifecycle risks:** Unit 2 moves the entire userData tree (settings + all per-profile partitions). Partial or repeated migration is the primary risk — the once-only guard and "leave old dir intact" rollback address it.
- **API surface parity:** the popup allowlist (Unit 4) is deliberately a *second, narrower* surface than the navigation allowlist; they must not be merged.
- **Unchanged invariants:** `ALLOWED_HOSTS`/`isTrusted` top-level navigation trust, `sanitizeDownloadName`/`containedInDownloads` download safety, block-seen/block-typing filters, per-profile partition isolation, and the scrypt PIN path are preserved. The salt rename affects only the legacy SHA-256 PIN path (mitigated by re-setup fallback); the publish target moves to `hungdoansy/messy` behind GitHub's rename redirect.

## Risks & Dependencies

| Risk | Mitigation |
|------|------------|
| Rename orphans existing users' data (userData path change) | Unit 2 migrates on first launch; old dir kept as rollback; explicit fresh-install and repeat-launch guards |
| Bridge rename misses a `mosx.*` reference → renderer crash | Atomic edit of preload+renderer; grep + runtime interaction test (Unit 1) |
| OAuth change widens trust boundary → security regression | Popup allowlist kept separate from `isTrusted`; child-nav guards retained; explicit security test scenarios (Unit 4) |
| PIN-salt rename locks out legacy-PIN users (pre-scrypt, never unlocked since) | Graceful PIN re-setup fallback when no stored hash verifies (Unit 1); cohort expected empty/tiny; reset accepted per no-exception directive |
| Renamed product ("Messy.app") leaves old "Mosx.app" bundle after auto-update | Note for release: verify updater replaces the bundle in place; document manual cleanup if both persist |
| GitHub repo rename breaks existing clients' update feed | GitHub preserves redirects on rename → `hungdoansy/mosx` update polls redirect to `hungdoansy/messy`; verify an update check from an old build post-rename |

## Documentation / Operational Notes

- README and `docs/` landing page become fully English and reflect the "Messy" name (Units 1, 3, 5).
- Release note for the version carrying this change should mention the rename and that existing accounts/settings are preserved automatically.

## Sources & References

- Upstream (provenance): `https://github.com/nct88/MessengerMulti-Windows` (renamed from `https://github.com/nct88/Messenger-Win`)
- Fork point: `7af750e` (v1.3.0)
- Applicable upstream fix: `6d7b4b6` (v1.4.0 — Google/Apple OAuth popup support)
- Related local code: `main.js` (`ALLOWED_HOSTS` :148, `isTrusted` :156, `setupWebContents` :524, `SETTINGS_PATH` :52, PIN salt :94), `preload.js:24`, `package.json` build block
- Prior plan: [docs/plans/2026-07-17-001-fix-macos-security-hardening-plan.md](docs/plans/2026-07-17-001-fix-macos-security-hardening-plan.md)

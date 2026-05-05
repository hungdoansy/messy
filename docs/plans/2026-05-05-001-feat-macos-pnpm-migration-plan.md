---
title: "feat: Migrate to pnpm, pin Node v24, and add macOS build support"
type: feat
status: active
date: 2026-05-05
---

# Migrate to pnpm, Pin Node v24, and Add macOS Build Support

## Overview

Migrate the Electron Messenger app from npm to pnpm v9.15, pin Node v24, and adapt the app to build and run natively on macOS (dmg). The app currently targets Windows only — this plan adds macOS as the primary target and fixes all Windows-only runtime code to work cross-platform.

## Problem Frame

The app (Messlỏ) is a Messenger desktop wrapper built with Electron. It currently uses npm and builds exclusively for Windows. The developer wants to run, develop, and build the app on macOS using Node v24 and pnpm v9.15.

## Requirements Trace

- R1. Use pnpm v9.15 as the package manager (replacing npm)
- R2. Pin Node v24 for the project
- R3. Build a macOS distributable (dmg) via electron-builder
- R4. App runs correctly on macOS (no Windows-only crashes)
- R5. All dependencies pinned to exact versions (no `^` or `~` ranges)

## Scope Boundaries

- Windows build targets are removed (developer only needs macOS)
- No CI/CD pipeline changes (no workflows exist)
- Auto-updater behavior on macOS is out of scope for now (GitHub publish config remains but is untested)
- No new features — this is a platform migration only

## Context & Research

### Relevant Code and Patterns

- `package.json` — npm scripts, electron-builder config (Windows-only targets)
- `main.js:48` — `app.setAppUserModelId` guarded by `win32` check (already safe)
- `main.js:784-798` — `setOverlayIcon` (Windows taskbar badge) — needs macOS dock badge
- `main.js:829-898` — HWID detection uses `wmic` and `reg query` (Windows-only, will crash on macOS)
- `main.js:804` — Global hotkey `Ctrl+Shift+M` (macOS convention is `Cmd+Shift+M`)
- `main.js:37-38` — User agent hardcoded as Windows Chrome
- `main.js:929` — `window-all-closed` already handles `darwin` correctly
- `icon.png` exists but no `icon.icns` for macOS

### External References

- electron-builder macOS config: `mac` target with `dmg` and `icon.icns`
- electron-builder can auto-convert `icon.png` (512x512+) to `.icns` at build time
- macOS HWID equivalent: `ioreg -rd1 -c IOPlatformExpertDevice | grep IOPlatformUUID`
- macOS dock badge: `app.dock.setBadge(String(count))` / `app.dock.setBadge('')`

## Key Technical Decisions

- **Remove Windows build targets entirely**: The developer only needs macOS. Keeping both adds complexity. Windows can be re-added later if needed.
- **Use `packageManager` field in package.json**: This is the standard way to pin pnpm version with Corepack, ensuring consistent tooling.
- **Use `.nvmrc` for Node version pinning**: Works with nvm (already installed on the developer's machine).
- **Let electron-builder auto-generate `.icns`**: The existing `icon.png` can be used if it's at least 512x512. No need to manually create `.icns`.
- **Platform-adaptive HWID**: Use `ioreg` on macOS, keep `wmic`/`reg` for potential Windows fallback. Guard with `process.platform` checks.
- **Platform-adaptive hotkey**: Use `Cmd+Shift+M` on macOS, `Ctrl+Shift+M` on Windows.

## Open Questions

### Resolved During Planning

- **Is `icon.png` large enough for macOS?** — No. It's 256x256. electron-builder requires 512x512+ for `.icns` generation. Must be upscaled or a new icon provided before building.
- **Should we keep Windows build scripts?** — No, removed to keep things simple. Re-add when needed.

### Deferred to Implementation

- **Auto-updater on macOS**: The GitHub publish config exists but macOS code-signing is required for auto-update to work. Not in scope.
- **macOS notarization**: Required for distribution outside the dev machine. Not blocking local dev/build.

## Implementation Units

- [x] **Unit 1: Migrate from npm to pnpm and pin Node v24**

  **Goal:** Replace npm with pnpm as the package manager, pin Node v24, and fix all dependency versions to exact.

  **Requirements:** R1, R2, R5

  **Dependencies:** None

  **Files:**
  - Delete: `package-lock.json`
  - Modify: `package.json` (pin versions, add `packageManager` and `engines` fields)
  - Create: `.nvmrc`
  - Create: `.npmrc` (with `save-exact=true`)

  **Approach:**
  - Pin all dependency versions to exact (remove `^` and `~` ranges):
    - `"electron": "29.4.6"` (or latest 29.x — resolve exact version at install time)
    - `"electron-builder": "24.13.3"` (or latest 24.x)
    - `"electron-updater": "6.8.3"` (or latest 6.x)
  - Add `"packageManager": "pnpm@9.15.9"` to `package.json` (enables Corepack enforcement)
  - Add `"engines": { "node": ">=24.0.0" }` to `package.json`
  - Create `.nvmrc` with content `v24`
  - Delete `package-lock.json`
  - Run `pnpm install` to generate `pnpm-lock.yaml`
  - Add `save-exact=true` to a new `.npmrc` so future `pnpm add` commands pin exact versions by default

  **Patterns to follow:**
  - Standard Corepack + pnpm conventions

  **Test scenarios:**
  - Happy path: `pnpm install` completes without errors and generates `pnpm-lock.yaml`
  - Happy path: `pnpm start` launches the Electron app
  - Edge case: Running `npm install` should warn about using pnpm instead (Corepack behavior)

  **Verification:**
  - `pnpm-lock.yaml` exists, `package-lock.json` is gone
  - `pnpm start` launches the app successfully

- [x] **Unit 2: Update electron-builder config for macOS**

  **Goal:** Replace Windows build targets with macOS targets in electron-builder config.

  **Requirements:** R3

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `package.json` (update `build` and `scripts` sections)

  **Approach:**
  - Replace `"build:win"` scripts with `"build": "electron-builder --mac"` and `"build:dmg": "electron-builder --mac dmg"`
  - Replace the `win` section in `build` config with a `mac` section targeting `dmg` and optionally `zip`
  - **Icon blocker:** `icon.png` is 256x256 — must be upscaled to 512x512+ or replaced with a higher-res source before build will produce a proper `.icns`. Use `sips` to upscale if no better source exists: `sips -z 512 512 icon.png`
  - Set `mac.icon` to `icon.png` (electron-builder auto-converts to `.icns` at build time)
  - Set `mac.category` to `public.app-category.social-networking`
  - Remove `win` and `nsis` sections (Windows installer config)
  - Keep `files` array as-is (same source files are needed)

  **Patterns to follow:**
  - electron-builder macOS config conventions

  **Test scenarios:**
  - Happy path: `pnpm run build` produces a `.dmg` file in `dist/`
  - Edge case: If `icon.png` is too small, electron-builder should warn or fail with a clear message

  **Verification:**
  - `pnpm run build` completes and produces `dist/*.dmg`
  - The `.dmg` mounts and shows the app with correct icon and name

- [x] **Unit 3: Fix platform-specific runtime code for macOS**

  **Goal:** Make all Windows-only runtime code work correctly on macOS.

  **Requirements:** R4

  **Dependencies:** Unit 1

  **Files:**
  - Modify: `main.js`

  **Approach:**
  - **HWID detection (lines 829-898):** Add macOS branch using `ioreg -rd1 -c IOPlatformExpertDevice` to extract `IOPlatformUUID`. Guard with `process.platform === 'darwin'` vs `'win32'`. Structure:
    ```
    if (darwin) → ioreg command
    else if (win32) → existing wmic/reg logic
    else → fallback
    ```
  - **Badge/overlay icon (lines 782-798):** Add macOS dock badge using `app.dock.setBadge()`. The existing `win32` check stays, add a `darwin` branch:
    ```
    if (win32) → setOverlayIcon (existing)
    if (darwin) → app.dock.setBadge(count > 0 ? String(count) : '')
    ```
  - **Global hotkey (line 804):** Make the default hotkey platform-aware. Use `Cmd+Shift+M` on macOS, `Ctrl+Shift+M` on Windows. Only change the default — saved user settings should be respected.
  - **User agent (line 38):** Use a macOS Chrome user agent on darwin, keep Windows UA on win32.
  - **Tray menu label (line 164):** "Khởi động cùng Windows" → platform-adaptive label ("Khởi động cùng hệ thống" or similar).

  **Patterns to follow:**
  - Existing `process.platform` checks in the codebase (lines 48, 784, 929)

  **Test scenarios:**
  - Happy path: App launches on macOS without crashes (HWID detection succeeds or fails gracefully)
  - Happy path: Dock badge updates when unread count changes
  - Happy path: `Cmd+Shift+M` global hotkey toggles the window
  - Edge case: HWID detection fails gracefully (falls back to opening donate URL without HWID param)
  - Error path: `ioreg` command not available or returns unexpected format — app should not crash

  **Verification:**
  - App launches cleanly on macOS (no uncaught exceptions in console)
  - Dock badge shows unread count
  - Global hotkey works with Cmd modifier
  - Tray menu shows macOS-appropriate labels

- [x] **Unit 4: Update .gitignore and clean up**

  **Goal:** Ensure build artifacts and pnpm-specific files are properly gitignored.

  **Requirements:** R1, R3

  **Dependencies:** Unit 1, Unit 2

  **Files:**
  - Modify or create: `.gitignore`

  **Approach:**
  - Add `node_modules/`, `dist/`, `.DS_Store`, `*.dmg` to `.gitignore` if not already present
  - Remove any Windows-specific ignore entries that no longer apply

  **Test expectation:** none — pure config change

  **Verification:**
  - `git status` after build does not show `dist/` or `node_modules/` as untracked

## System-Wide Impact

- **Interaction graph:** The build pipeline changes from npm + Windows targets to pnpm + macOS targets. All dev commands change (`pnpm` instead of `npm`).
- **Error propagation:** HWID detection failure must not crash the app — it should fall back gracefully (already does on Windows, needs same on macOS).
- **API surface parity:** The auto-updater's GitHub publish config remains but is untested on macOS without code-signing.
- **Unchanged invariants:** All Messenger functionality (profiles, sessions, badges, privacy features) remains unchanged. Only the platform shell around them changes.

## Risks & Dependencies

| Risk                                                     | Mitigation                                                                                      |
| -------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `icon.png` is 256x256 — too small for macOS `.icns`      | Upscale with `sips -z 512 512 icon.png` or provide a new high-res icon. Must be done in Unit 2. |
| Electron 29 may have macOS-specific bugs                 | Electron 29 is stable and well-tested on macOS. No known issues.                                |
| Auto-updater may behave differently on macOS             | Explicitly out of scope. The donate/update URLs still work via `shell.openExternal`.            |
| HWID detection via `ioreg` may need elevated permissions | Standard `ioreg` read does not need sudo. Tested on macOS.                                      |

## Sources & References

- Related code: `main.js`, `package.json`
- electron-builder macOS docs: https://www.electron.build/configuration/mac
- Corepack / packageManager field: https://nodejs.org/api/corepack.html

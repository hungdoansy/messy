<div align="center">

<img src="icon.png" width="72" height="72" alt="Messy" />

# Messy

**A multi-account Messenger manager for macOS — built on Electron + Chromium.**

macOS · Apple Silicon (arm64) only

</div>

---

## Credits

Messy is a **macOS fork** of
[nct88/Messenger-Win](https://github.com/nct88/Messenger-Win) (since renamed to
[nct88/MessengerMulti-Windows](https://github.com/nct88/MessengerMulti-Windows)),
built **specifically for macOS on Apple Silicon (Apple M chips)**. It was forked
at v1.3.0 and then substantially rewritten for macOS with a hardened security
model (Electron 43, `WebContentsView`, a strict origin trust boundary, sandboxed
per-account partitions, and a scrypt-based app lock). Thanks to the original
author for the upstream project.

## Features

- **Multi-account** — Log in and use several Messenger accounts at once, switching with one click from the sidebar.
- **Data isolation** — Each account runs in its own session (cookies, cache, and localStorage are fully separated).
- **Privacy** — Block "Seen" (read receipts) and "Typing" indicators.
- **Notifications & badges** — Get notifications and an unread count per account.
- **Auto-fetch avatar** — Automatically pulls the profile picture from Messenger.
- **App lock (PIN)** — Protect the app with a PIN.
- **Dark/Light mode** — Switch between themes.

## Installation

1. Download the latest release `.dmg` from the
   [Releases page](https://github.com/hungdoansy/messy/releases/latest).
2. (Optional) Verify the download's checksum against the value published on
   the release page:
   ```bash
   shasum -a 256 Messy-*.dmg
   ```
3. Open the `.dmg` and run the installer inside it.
4. Drag **Messy.app** into your `/Applications` folder.
5. Since the app isn't notarized by default, macOS Gatekeeper will quarantine
   it. Clear the quarantine attribute so it can run:
   ```bash
   xattr -cr /Applications/Messy.app
   ```
6. Right-click **Messy.app** in Finder and choose **Open**, then confirm in
   the dialog. This one-time step lets Gatekeeper allow the unsigned build to
   launch — subsequent launches work normally (double-click).

## Requirements

- **macOS on Apple Silicon (Apple M chips)** — Messy builds and ships for `arm64` only.
- [Node.js](https://nodejs.org/) v24+
- [pnpm](https://pnpm.io/) v11+

## Install & Run

```bash
pnpm install
pnpm start
```

## Build (macOS — Apple Silicon)

The build targets macOS **arm64** (Apple M chips).

```bash
pnpm run build      # produces a .dmg in dist/
```

Output file: `dist/Messy-<version>-arm64.dmg`.

### Code Signing & Notarization

Distributing outside your dev machine requires an Apple Developer account:

- Install a **Developer ID Application** certificate into your Keychain.
- Set `notarize: true` in `package.json` (under `build.mac`) and provide the
  credentials via environment variables (App Store Connect API key):
  `APPLE_API_KEY`, `APPLE_API_KEY_ID`, `APPLE_API_ISSUER`.
- Without a certificate the build still runs locally (ad-hoc signing) — set
  `CSC_IDENTITY_AUTO_DISCOVERY=false` — but it **cannot** be distributed or
  auto-updated. Auto-update only applies to a properly signed build.

The app enables the **hardened runtime** with entitlements in
`build/entitlements.mac.plist` and tightens the Electron fuses in
`package.json` (`electronFuses`).

> **Note (Apple Silicon):** tightening the Electron fuses **modifies** the
> `Electron Framework` binary, which **invalidates** its existing signature.
> On Apple M chips with the hardened runtime, running a binary whose signature
> doesn't match is killed by macOS immediately
> (`EXC_BAD_ACCESS / Code Signature Invalid`). That is why the
> `resetAdHocDarwinSignature: true` fuse is enabled — it **re-signs ad-hoc
> right after flipping the fuses**, so an unsigned (dev) build still runs. When
> signing with a real Developer ID, electron-builder signs over this ad-hoc
> signature.

## Releasing

Releases are produced by the **Apple-Silicon-only** GitHub Actions workflow at
[`.github/workflows/release.yml`](.github/workflows/release.yml). Trigger it
manually (**Actions → Release → Run workflow**) with a `X.Y.Z` version; it
builds the `arm64` `.dmg`, generates release notes, and publishes a GitHub
Release whose assets feed `electron-updater` auto-update.

The workflow signs **and** notarizes when the signing secrets are present, and
otherwise falls back to an ad-hoc (locally-runnable, non-distributable) build —
it never fails purely for missing secrets.

**Repository secrets** (add under **Settings → Secrets and variables →
Actions**):

| Secret | Purpose | Required for |
| ------ | ------- | ------------ |
| `GEMINI_API_KEY`     | Rewrites the commit log into user-facing release notes. Omit to fall back to a raw commit list. | Nicer changelog (optional) |
| `CSC_LINK`           | Base64-encoded Developer ID Application certificate (`.p12`). | Signed release |
| `CSC_KEY_PASSWORD`   | Password for the `.p12` certificate. | Signed release |
| `APPLE_API_KEY`      | Base64-encoded App Store Connect API key (`.p8`); the workflow decodes it to a file. | Notarization |
| `APPLE_API_KEY_ID`   | App Store Connect API key ID. | Notarization |
| `APPLE_API_ISSUER`   | App Store Connect issuer ID. | Notarization |

Without the signing secrets the workflow still produces a runnable ad-hoc
`.dmg`; add them to enable Gatekeeper-clean distribution and auto-update.

## Project structure

| File                          | Purpose                                                              |
| ----------------------------- | ------------------------------------------------------------------- |
| `main.js`                     | App lifecycle, partitions, WebContentsView, and IPC.                |
| `trust.js`                    | Pure origin trust boundary — parses URLs and matches the hostname against an allowlist (unit-tested). |
| `preload.js`                  | Secure bridge between the DOM and the backend.                      |
| `renderer.js`                 | Multi-account sidebar logic and the modal UI.                       |
| `index.html`                  | Left sidebar (accounts), right sidebar (tools), and modals.         |
| `custom_style.css`            | Dark-glass styling and hiding Facebook's ads.                       |
| `build/entitlements.mac.plist`| Hardened-runtime entitlements for the macOS build.                  |
| `test/`                       | Unit tests (`node --test`) — e.g. `trust.test.js` for the trust boundary. |

## License

MIT

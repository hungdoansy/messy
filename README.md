# Messy

<p align="center">
  <img src="icon.png" width="64" height="64" alt="Messy" />
</p>

A multi-account Messenger manager for macOS — built on Electron + Chromium.

---

## Features

- **Multi-account** — Log in and use several Messenger accounts at once, switching with one click from the sidebar.
- **Data isolation** — Each account runs in its own session (cookies, cache, and localStorage are fully separated).
- **Privacy** — Block "Seen" (read receipts) and "Typing" indicators.
- **Notifications & badges** — Get notifications and an unread count per account.
- **Auto-fetch avatar** — Automatically pulls the profile picture from Messenger.
- **App lock (PIN)** — Protect the app with a PIN.
- **Dark/Light mode** — Switch between themes.

## Requirements

- [Node.js](https://nodejs.org/) v24+
- [pnpm](https://pnpm.io/) v9.15+

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

## Project structure

| File               | Purpose                                                     |
| ------------------ | ----------------------------------------------------------- |
| `main.js`          | App lifecycle, partitions, WebContentsView, and IPC.        |
| `renderer.js`      | Multi-account sidebar logic and the modal UI.               |
| `index.html`       | Left sidebar (accounts), right sidebar (tools), and modals. |
| `preload.js`       | Secure bridge between the DOM and the backend.              |
| `custom_style.css` | Dark-glass styling and hiding Facebook's ads.               |

## Credits

Messy is a macOS fork of [nct88/Messenger-Win](https://github.com/nct88/Messenger-Win)
(since renamed to [nct88/MessengerMulti-Windows](https://github.com/nct88/MessengerMulti-Windows)).
It was forked at v1.3.0 and then substantially rewritten for macOS with a
hardened security model (Electron 43, `WebContentsView`, a strict origin trust
boundary, sandboxed per-account partitions, and a scrypt-based app lock).
Thanks to the original author for the upstream project.

## License

MIT

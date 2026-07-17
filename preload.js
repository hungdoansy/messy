// ============================================================
//  Messy — Shell preload bridge
//  Attached ONLY to the trusted local shell window (index.html).
//  The untrusted Messenger views get NO preload (see main.js).
//
//  Exposes a minimal, channel-allowlisted API on window.messy.
//  Never exposes ipcRenderer, require, or Node APIs to the page.
//  Secrets (e.g. the app-lock PIN hash) never cross this bridge:
//  PIN hashing/verification happens in the main process.
// ============================================================
const { contextBridge, ipcRenderer, webUtils } = require("electron");

// Fire-and-forget send (renderer -> main). Channels are fixed below.
const send = (channel, ...args) => ipcRenderer.send(channel, ...args);

// Subscribe to a main -> renderer channel. The raw IpcRendererEvent is
// never forwarded to the page — only the payload.
function subscribe(channel, callback) {
  const listener = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld("messy", {
  // ── Profile / view control ──
  switchProfile: (profile) => send("switch-profile", profile),
  setBrowserViewVisibility: (visible) =>
    send("set-browserview-visibility", !!visible),
  deleteProfile: (id) => send("delete-profile", id),
  clearNewProfileSession: (partition) =>
    send("clear-new-profile-session", partition),
  logoutProfile: (data) => send("logout-profile", data),

  // ── Toolbar ──
  setTheme: (isDark) => send("set-theme", !!isDark),
  zoomIn: () => send("zoom-in"),
  zoomOut: () => send("zoom-out"),
  toggleFullscreen: () => send("toggle-fullscreen"),
  toggleAlwaysOnTop: () => send("toggle-always-on-top"),
  reloadPage: () => send("reload-page"),
  goHome: () => send("go-home"),
  goBack: () => send("go-back"),

  // ── Badge ──
  updateBadge: (count) => send("update-badge", count),

  // ── External links (scheme/host validated in main) ──
  openExternal: (url) => send("open-external", url),

  // ── Resolve a picked File's local path (replaces removed File.path) ──
  getPathForFile: (file) => webUtils.getPathForFile(file),

  // ── Settings (synchronous reads; contain NO secrets) ──
  getSettings: () => ipcRenderer.sendSync("get-settings"),
  getLockSettings: () => ipcRenderer.sendSync("get-lock-settings"),

  // ── App lock (hashing + verification live in main) ──
  setupPin: (pin) => ipcRenderer.invoke("applock:setup", pin),
  verifyPin: (pin) => ipcRenderer.invoke("applock:verify", pin),
  disableLock: () => send("applock:disable"),
  setLockTimeout: (minutes) => send("applock:set-timeout", minutes),

  // ── Downloads (open by id; main resolves + re-validates the path) ──
  openDownloadFile: (id) => send("open-download-file", id),
  openDownloadFolder: (id) => send("open-download-folder", id),
  cancelDownload: (id) => send("cancel-download", id),

  // ── Events (main -> renderer) ──
  onProfileBadge: (cb) => subscribe("update-profile-badge", cb),
  onProfileAvatar: (cb) => subscribe("update-profile-avatar", cb),
  onLogoutDone: (cb) => subscribe("logout-profile-done", cb),
  onDownloadStarted: (cb) => subscribe("download-started", cb),
  onDownloadProgress: (cb) => subscribe("download-progress", cb),
  onDownloadDone: (cb) => subscribe("download-done", cb),
});

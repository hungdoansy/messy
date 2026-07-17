// ============================================================
//  Messy — Multi-account Messenger desktop app for macOS
//  Engine: Chromium (Electron)
// ============================================================

const {
  app,
  BrowserWindow,
  WebContentsView,
  shell,
  session,
  Menu,
  MenuItem,
  Tray,
  globalShortcut,
  ipcMain,
  nativeImage,
  nativeTheme,
  dialog,
} = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");

// ============================================================
//  DOWNLOAD SYSTEM
// ============================================================
let activeDownloads = new Map(); // id -> { item, filename, savePath, received, total }
let completedDownloads = new Map(); // id -> sanitized absolute savePath (open-by-id)
let downloadCounter = 0;

// ============================================================
//  GENERAL CONFIG
// ============================================================
const MESSENGER_URL = "https://www.facebook.com/messages";
const APP_ID = "com.messy.app";
const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

// ============================================================
//  SINGLE INSTANCE LOCK
// ============================================================
const gotTheLock = app.requestSingleInstanceLock();
if (!gotTheLock) {
  app.quit();
}

// ============================================================
//  USERDATA MIGRATION (legacy app name -> Messy)
//  Electron derives the userData directory name from the app's
//  product name, so renaming the app would orphan an existing
//  user's profiles, sessions, and settings. On the first launch
//  under the new name, if the new userData dir is still empty,
//  copy over the most recent legacy directory. The old directory
//  is left intact as a rollback safety net. Best-effort: on any
//  failure the app simply starts with default settings.
// ============================================================
const SETTINGS_FILE = "settings.json";

// Disposable Chromium caches — large and regenerated on demand, so they are
// skipped during migration to keep the startup copy small and fast.
const MIGRATION_SKIP_DIRS = new Set([
  "Cache",
  "Code Cache",
  "GPUCache",
  "DawnCache",
  "DawnGraphiteCache",
  "DawnWebGPUCache",
  "ShaderCache",
  "GrShaderCache",
  "Service Worker",
  "component_crx_cache",
  "blob_storage",
]);

function migrateLegacyUserData() {
  try {
    const appDataDir = app.getPath("appData");
    const newDir = app.getPath("userData");

    // settings.json is the single source of truth for "already migrated /
    // already using the app under the new name". Keying on this marker (not
    // "the dir has any content") avoids an incidental Chromium file
    // suppressing a needed migration.
    if (fs.existsSync(path.join(newDir, SETTINGS_FILE))) return;

    // Find the newest prior product dir that actually holds app settings.
    const LEGACY_NAMES = ["Mosx", "Messlỏ"];
    let oldDir = null;
    for (const name of LEGACY_NAMES) {
      const candidate = path.join(appDataDir, name);
      if (candidate === newDir) continue;
      if (fs.existsSync(path.join(candidate, SETTINGS_FILE))) {
        oldDir = candidate;
        break;
      }
    }
    if (!oldDir) return;

    // Copy everything except caches AND settings.json. settings.json is
    // written last (below) so it becomes the atomic completion marker: if
    // this copy throws partway, settings.json is absent and the migration
    // retries on the next launch instead of being recorded as complete.
    fs.cpSync(oldDir, newDir, {
      recursive: true,
      errorOnExist: false,
      filter: (src) => {
        const rel = path.relative(oldDir, src);
        if (!rel) return true;
        const top = rel.split(path.sep)[0];
        if (MIGRATION_SKIP_DIRS.has(top)) return false;
        return rel !== SETTINGS_FILE;
      },
    });
    // Completion marker — copied only after the bulk copy succeeds.
    fs.copyFileSync(
      path.join(oldDir, SETTINGS_FILE),
      path.join(newDir, SETTINGS_FILE),
    );
  } catch {
    // Migration is best-effort; app still launches on defaults.
  }
}
migrateLegacyUserData();

// ============================================================
//  SETTINGS PERSISTENCE
// ============================================================
const SETTINGS_PATH = path.join(app.getPath("userData"), "settings.json");

const DEFAULT_SETTINGS = {
  windowBounds: { width: 1200, height: 800 },
  startMinimized: false,
  autoLaunch: false,
  minimizeToTray: true,
  globalHotkey: process.platform === "darwin" ? "Cmd+Shift+M" : "Ctrl+Shift+M",
  currentTheme: "default",
  isDarkMode: true,
  alwaysOnTop: false,
  blockSeen: false,
  blockTyping: false,
  appLockEnabled: false,
  appLockHash: "",
  appLockTimeout: 5,
};

function loadSettings() {
  try {
    const data = fs.readFileSync(SETTINGS_PATH, "utf8");
    return { ...DEFAULT_SETTINGS, ...JSON.parse(data) };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function saveSettings(data) {
  try {
    fs.writeFileSync(SETTINGS_PATH, JSON.stringify(data, null, 2), "utf8");
  } catch (err) {}
}

// ============================================================
//  APP-LOCK PIN HASHING (main-process only)
//  The PIN hash never crosses to any renderer. New PINs use scrypt
//  with a per-install random salt; legacy sha256 hashes are still
//  accepted and transparently upgraded on the next successful unlock.
// ============================================================
function legacyPinHash(pin) {
  return crypto
    .createHash("sha256")
    .update(pin + "_messy_salt_2026")
    .digest("hex");
}

function makePinHash(pin) {
  const salt = crypto.randomBytes(16);
  const dk = crypto.scryptSync(String(pin), salt, 32);
  return `scrypt$${salt.toString("hex")}$${dk.toString("hex")}`;
}

function verifyPinHash(pin, stored) {
  if (!stored) return false;
  try {
    if (stored.startsWith("scrypt$")) {
      const [, saltHex, hashHex] = stored.split("$");
      const dk = crypto.scryptSync(String(pin), Buffer.from(saltHex, "hex"), 32);
      const expected = Buffer.from(hashHex, "hex");
      return dk.length === expected.length && crypto.timingSafeEqual(dk, expected);
    }
    // Legacy sha256 hex
    const cand = Buffer.from(legacyPinHash(pin), "hex");
    const expected = Buffer.from(stored, "hex");
    return (
      cand.length === expected.length && crypto.timingSafeEqual(cand, expected)
    );
  } catch {
    return false;
  }
}

// ============================================================
//  SAFE EXTERNAL NAVIGATION
//  Only ever open http/https/mailto in the OS handler. Rejects
//  file:, data:, javascript:, custom-scheme, and UNC targets.
// ============================================================
function safeOpenExternal(url) {
  try {
    const u = new URL(String(url));
    if (
      u.protocol === "https:" ||
      u.protocol === "http:" ||
      u.protocol === "mailto:"
    ) {
      shell.openExternal(url);
    }
  } catch {}
}

// ============================================================
//  ORIGIN TRUST BOUNDARY
//  The origin trust boundary lives in ./trust.js (pure, unit-tested):
//    isTrusted(url)          — top-level navigation trust for the view
//    isAllowedPopupHost(url) — popup-scoped OAuth login trust (separate)
//  Substring checks (url.includes("facebook.com")) are bypassable and are
//  never used; both helpers match the *parsed* hostname against an allowlist.
// ============================================================
const { isTrusted, isAllowedPopupHost } = require("./trust");

// IPC sender guard: sensitive channels are honored only from the trusted
// local shell window. (The Messenger views have no preload/Node and cannot
// reach ipcRenderer at all — this is defense-in-depth.)
function isShellSender(event) {
  return !!mainWindow && event.sender === mainWindow.webContents;
}

// ============================================================
//  DOWNLOAD PATH SAFETY
//  A Content-Disposition filename is attacker-controlled. Reduce to a
//  bare basename and confirm the resolved path stays inside Downloads.
// ============================================================
function sanitizeDownloadName(raw) {
  const base = path.basename(String(raw || "")).replace(/[/\\]/g, "");
  return base || "download";
}

function containedInDownloads(p) {
  const dir = path.resolve(app.getPath("downloads"));
  const resolved = path.resolve(String(p || ""));
  return resolved === dir || resolved.startsWith(dir + path.sep);
}

// ============================================================
//  GLOBAL STATE
// ============================================================
let mainWindow = null;
let tray = null;
let settings = loadSettings();
let isQuitting = false;
let unreadCount = 0;

// App-lock brute-force throttle (main-side, authoritative).
let pinFailCount = 0;
let pinLockUntil = 0;

let browserViews = {}; // { profileId: WebContentsView }
let attachedView = null; // the WebContentsView currently shown
let activeProfileId = null;

// ============================================================
//  SYSTEM TRAY
// ============================================================
function createTray() {
  const iconPath = path.join(__dirname, "icon.png");
  let trayIcon;
  try {
    trayIcon = nativeImage
      .createFromPath(iconPath)
      .resize({ width: 16, height: 16 });
  } catch {
    trayIcon = nativeImage.createEmpty();
  }
  tray = new Tray(trayIcon);
  updateTrayMenu();
  tray.setToolTip("Messy");

  tray.on("click", () => {
    if (!mainWindow) return;
    if (mainWindow.isVisible() && mainWindow.isFocused()) {
      mainWindow.hide();
    } else {
      mainWindow.show();
      mainWindow.focus();
    }
  });

  tray.on("double-click", () => {
    if (!mainWindow) return;
    mainWindow.show();
    mainWindow.focus();
  });
}

function updateTrayMenu() {
  if (!tray) return;
  const contextMenu = Menu.buildFromTemplate([
    {
      label: "💬 Open Messenger",
      click: () => {
        mainWindow.show();
        mainWindow.focus();
      },
    },
    { type: "separator" },
    {
      label: "🔄 Reload page",
      click: () => {
        if (activeProfileId && browserViews[activeProfileId]) {
          browserViews[activeProfileId].webContents.reload();
        }
      },
    },
    {
      label: "🚀 Launch at login",
      type: "checkbox",
      checked: settings.autoLaunch,
      click: (item) => toggleAutoLaunch(item.checked),
    },
    {
      label: "📌 Minimize to tray on close",
      type: "checkbox",
      checked: settings.minimizeToTray,
      click: (item) => {
        settings.minimizeToTray = item.checked;
        saveSettings(settings);
      },
    },
    { type: "separator" },
    {
      label: "🛡️ Security",
      submenu: [
        {
          label: 'Block "Seen" receipts',
          type: "checkbox",
          checked: settings.blockSeen,
          click: (item) => toggleBlockSeen(item.checked),
        },
        {
          label: 'Block "Typing" indicator',
          type: "checkbox",
          checked: settings.blockTyping,
          click: (item) => toggleBlockTyping(item.checked),
        },
      ],
    },
    { type: "separator" },
    { label: "⬇️ Check for updates", click: () => checkForUpdates(true) },
    { type: "separator" },
    {
      label: "❌ Quit completely",
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(contextMenu);
}

function toggleBlockSeen(enable) {
  settings.blockSeen = enable;
  saveSettings(settings);
}

function toggleBlockTyping(enable) {
  settings.blockTyping = enable;
  saveSettings(settings);
}

// ============================================================
//  AUTO UPDATER
// ============================================================
let isManualUpdateCheck = false;

function setupAutoUpdater() {
  autoUpdater.autoDownload = false;

  autoUpdater.on("update-available", (info) => {
    dialog
      .showMessageBox({
        type: "info",
        title: "Update available",
        message: `A new update v${info.version} is available. Do you want to download and install it?`,
        buttons: ["Download", "Skip"],
      })
      .then((result) => {
        if (result.response === 0) {
          autoUpdater.downloadUpdate();
        }
      });
  });

  autoUpdater.on("update-not-available", (info) => {
    if (isManualUpdateCheck) {
      dialog.showMessageBox({
        title: "No updates",
        message: "You are using the latest version.",
      });
      isManualUpdateCheck = false;
    }
  });

  autoUpdater.on("update-downloaded", () => {
    dialog
      .showMessageBox({
        title: "Update downloaded",
        message:
          "The update has been downloaded. The app will restart to install it.",
        buttons: ["Install and Restart"],
      })
      .then(() => {
        isQuitting = true;
        autoUpdater.quitAndInstall();
      });
  });

  autoUpdater.on("error", (err) => {
    if (isManualUpdateCheck) {
      let errorMessage =
        err == null ? "Unknown error" : (err.stack || err).toString();
      if (
        errorMessage.includes("No published versions on GitHub") ||
        errorMessage.includes("404 Not Found")
      ) {
        dialog.showMessageBox({
          type: "info",
          title: "Update info",
          message:
            "No updates have been released yet. You are using the latest version!",
        });
      } else {
        dialog.showErrorBox("Update error", errorMessage);
      }
      isManualUpdateCheck = false;
    }
  });

  // Automatically check for updates on startup
  setTimeout(() => {
    autoUpdater.checkForUpdates();
  }, 5000);
}

function checkForUpdates(manual = false) {
  isManualUpdateCheck = manual;
  autoUpdater.checkForUpdates();
}

function toggleAutoLaunch(enable) {
  settings.autoLaunch = enable;
  saveSettings(settings);
  app.setLoginItemSettings({ openAtLogin: enable, path: app.getPath("exe") });
}

// ============================================================
//  VIEW MANAGEMENT (WebContentsView)
// ============================================================
// The window shows at most one Messenger view at a time, layered over the
// shell (index.html) which renders the sidebars. showView swaps the attached
// child view; contentView.addChildView replaces the old setBrowserView API.
function showView(view) {
  if (!mainWindow) return;
  if (view) {
    if (attachedView && attachedView !== view) {
      try {
        mainWindow.contentView.removeChildView(attachedView);
      } catch {}
    }
    if (attachedView !== view) {
      mainWindow.contentView.addChildView(view);
      attachedView = view;
    }
    updateBrowserViewBounds();
  } else if (attachedView) {
    try {
      mainWindow.contentView.removeChildView(attachedView);
    } catch {}
    attachedView = null;
  }
}

function detachView(view) {
  if (attachedView === view) {
    try {
      mainWindow.contentView.removeChildView(view);
    } catch {}
    attachedView = null;
  }
}

function destroyViewContents(view) {
  try {
    const wc = view.webContents;
    if (typeof wc.destroy === "function") wc.destroy();
    else wc.close();
  } catch {}
}

function updateBrowserViewBounds() {
  if (!mainWindow || !activeProfileId || !browserViews[activeProfileId]) return;
  const bounds = mainWindow.getContentBounds();
  // Left sidebar: 52px, Right sidebar: 42px
  const LEFT_SIDEBAR = 52;
  const RIGHT_SIDEBAR = 42;
  browserViews[activeProfileId].setBounds({
    x: LEFT_SIDEBAR,
    y: 0,
    width: Math.max(bounds.width - LEFT_SIDEBAR - RIGHT_SIDEBAR, 0),
    height: Math.max(bounds.height, 0),
  });
}

function setupDownloadHandler(sess) {
  if (sess._downloadHandlerSet) return;
  sess._downloadHandlerSet = true;

  sess.on("will-download", (event, item, webContents) => {
    const id = ++downloadCounter;
    // Content-Disposition filename is attacker-controlled → strip to a bare
    // basename and confirm the resolved path stays inside Downloads.
    const filename = sanitizeDownloadName(item.getFilename());
    const downloadsPath = path.resolve(app.getPath("downloads"));
    let savePath = path.resolve(path.join(downloadsPath, filename));
    if (!containedInDownloads(savePath)) {
      savePath = path.join(downloadsPath, "download");
    }
    item.setSavePath(savePath);

    const total = item.getTotalBytes();
    activeDownloads.set(id, { item, filename, savePath, received: 0, total });

    // Notify renderer about new download
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send("download-started", {
        id,
        filename,
        savePath,
        total,
      });
    }

    item.on("updated", (event, state) => {
      const received = item.getReceivedBytes();
      const dl = activeDownloads.get(id);
      if (dl) dl.received = received;

      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download-progress", {
          id,
          received,
          total: item.getTotalBytes(),
          state,
        });
      }
    });

    item.once("done", (event, state) => {
      if (state === "completed") completedDownloads.set(id, savePath);
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send("download-done", {
          id,
          state,
          savePath,
          filename,
        });
      }
      activeDownloads.delete(id);
    });
  });
}

function setupWebContents(contents, profileId) {
  // Setup download handler for this view's session
  setupDownloadHandler(contents.session);

  contents.setWindowOpenHandler(({ url }) => {
    if (isTrusted(url)) {
      return { action: "allow" };
    }
    // "Continue with Google/Apple" opens a login popup on a third-party
    // OAuth origin. Allow it as a popup window that shares this view's
    // session (so the login completes in the right account), but keep it
    // out of the top-level navigation trust below.
    if (isAllowedPopupHost(url)) {
      return {
        action: "allow",
        overrideBrowserWindowOptions: {
          width: 600,
          height: 720,
          webPreferences: {
            contextIsolation: true,
            nodeIntegration: false,
            sandbox: true,
          },
        },
      };
    }
    safeOpenExternal(url);
    return { action: "deny" };
  });

  // Block navigation/redirect of the Messenger view to any non-allowlisted
  // origin. (Top-level will-navigate does not fire for child-frame navs;
  // combined with the deny-by-default window-open handler above.)
  // NOTE: the main view uses isTrusted only — the OAuth popup allowlist must
  // never widen top-level navigation trust.
  const blockUntrustedNav = (event, url) => {
    if (!isTrusted(url)) event.preventDefault();
  };
  contents.on("will-navigate", blockUntrustedNav);
  contents.on("will-redirect", blockUntrustedNav);

  // A popup opened via the allowed window-open path gets a fresh webContents
  // that would otherwise bypass the navigation allowlist. Apply the same
  // guards (recursively, since the popup can spawn its own popups). The popup
  // may legitimately move between the OAuth provider and Facebook/Messenger,
  // so it also permits the popup-scoped hosts — but nothing else.
  contents.on("did-create-window", (childWindow) => {
    const wc = childWindow.webContents;
    const popupNavAllowed = (url) => isTrusted(url) || isAllowedPopupHost(url);
    wc.setWindowOpenHandler(({ url }) => {
      if (popupNavAllowed(url)) return { action: "allow" };
      safeOpenExternal(url);
      return { action: "deny" };
    });
    const blockUntrustedPopupNav = (event, url) => {
      if (!popupNavAllowed(url)) event.preventDefault();
    };
    wc.on("will-navigate", blockUntrustedPopupNav);
    wc.on("will-redirect", blockUntrustedPopupNav);

    // Treat the popup as an OAuth round-trip: only when it has actually
    // visited a provider (Google/Apple) and THEN returns to Facebook/
    // Messenger is the login complete. Guarding on visitedOAuth avoids
    // closing the popup on an incidental Facebook navigation before the
    // provider step. On completion, refresh the parent view and close it.
    let visitedOAuth = false;
    wc.on("did-navigate", (event, url) => {
      if (isAllowedPopupHost(url)) {
        visitedOAuth = true;
        return;
      }
      if (visitedOAuth && isTrusted(url)) {
        try {
          contents.reload();
        } catch {}
        try {
          childWindow.close();
        } catch {}
      }
    });
  });

  contents.on("context-menu", (event, params) => {
    const menu = new Menu();
    if (params.misspelledWord) {
      for (const suggestion of params.dictionarySuggestions) {
        menu.append(
          new MenuItem({
            label: suggestion,
            click: () => contents.replaceMisspelling(suggestion),
          }),
        );
      }
      if (params.dictionarySuggestions.length > 0)
        menu.append(new MenuItem({ type: "separator" }));
    }
    if (params.selectionText)
      menu.append(new MenuItem({ label: "📋 Copy", role: "copy" }));
    if (params.isEditable) {
      menu.append(new MenuItem({ label: "📋 Paste", role: "paste" }));
      menu.append(new MenuItem({ label: "✂️ Cut", role: "cut" }));
      menu.append(new MenuItem({ label: "📝 Select all", role: "selectAll" }));
    }
    if (params.linkURL) {
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(
        new MenuItem({
          label: "🔗 Open link",
          click: () => safeOpenExternal(params.linkURL),
        }),
      );
      menu.append(
        new MenuItem({
          label: "📋 Copy link",
          click: () => require("electron").clipboard.writeText(params.linkURL),
        }),
      );
    }
    if (params.mediaType === "image") {
      menu.append(new MenuItem({ type: "separator" }));
      menu.append(
        new MenuItem({
          label: "💾 Save image",
          click: () => contents.downloadURL(params.srcURL),
        }),
      );
    }
    menu.append(new MenuItem({ type: "separator" }));
    menu.append(
      new MenuItem({
        label: "🔄 Reload page",
        click: () => contents.reload(),
      }),
    );
    menu.append(
      new MenuItem({
        label: "◀️ Go back",
        enabled: contents.canGoBack(),
        click: () => contents.goBack(),
      }),
    );
    if (menu.items.length > 0) menu.popup({ window: mainWindow });
  });

  contents.on("did-finish-load", async () => {
    const cssPath = path.join(__dirname, "custom_style.css");
    try {
      const cssData = fs.readFileSync(cssPath, "utf8");
      contents.insertCSS(cssData);
    } catch (e) {}
  });

  const avatarInterval = setInterval(async () => {
    if (contents.isDestroyed()) {
      clearInterval(avatarInterval);
      return;
    }
    const avatarScript = `
      (function() {
        let nav = document.querySelector('div[role="navigation"]');
        if (nav) {
          let images = nav.querySelectorAll('svg image');
          for (let img of images) {
            let href = img.getAttribute('xlink:href') || img.getAttribute('href');
            if (href && (href.includes('scontent') || href.includes('fbcdn'))) return href;
          }
        }
        let images = document.querySelectorAll('svg image');
        for (let img of images) {
          let href = img.getAttribute('xlink:href') || img.getAttribute('href');
          if (href && (href.includes('scontent') || href.includes('fbcdn'))) return href;
        }
        let imgs = document.querySelectorAll('img');
        for (let img of imgs) {
          if (img.src && (img.src.includes('scontent') || img.src.includes('fbcdn')) && img.width > 20 && img.width < 100) return img.src;
        }
        return null;
      })();
    `;
    try {
      const avatarUrl = await contents.executeJavaScript(avatarScript);
      if (avatarUrl && mainWindow && profileId) {
        mainWindow.webContents.send("update-profile-avatar", {
          id: profileId,
          avatarUrl,
        });
      } else {
        const cookies = await contents.session.cookies.get({ name: "c_user" });
        if (cookies && cookies.length > 0) {
          const uid = cookies[0].value;
          const fbAvatar = `https://graph.facebook.com/${uid}/picture?width=150&height=150`;
          if (mainWindow && profileId) {
            mainWindow.webContents.send("update-profile-avatar", {
              id: profileId,
              avatarUrl: fbAvatar,
            });
          }
        }
      }
    } catch (e) {}
  }, 5000);

  // ── Unread badge per profile ──
  const unreadInterval = setInterval(async () => {
    if (contents.isDestroyed()) {
      clearInterval(unreadInterval);
      return;
    }
    try {
      const count = await contents.executeJavaScript(`
        (function() {
          var title = document.title || '';
          var match = title.match(/\\((\\d+)\\)/);
          if (match) return parseInt(match[1]);
          var badges = document.querySelectorAll('[data-testid="MWJewelThreadListUnread"], span.pq6dq46d');
          var total = 0;
          badges.forEach(function(b) {
            var n = parseInt(b.textContent);
            if (!isNaN(n)) total += n;
          });
          return total;
        })();
      `);
      if (mainWindow && !mainWindow.isDestroyed() && profileId) {
        mainWindow.webContents.send("update-profile-badge", {
          id: profileId,
          count: count || 0,
        });
      }
    } catch (e) {}
  }, 3000);

  if (app.isPackaged) {
    contents.on("before-input-event", (event, input) => {
      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key === "I")
      )
        event.preventDefault();
    });
    contents.on("devtools-opened", () => contents.closeDevTools());
  } else {
    contents.on("before-input-event", (event, input) => {
      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key === "I")
      )
        contents.toggleDevTools();
    });
  }
}

// ============================================================
//  CREATE MAIN WINDOW
// ============================================================
function createWindow() {
  const { windowBounds } = settings;

  mainWindow = new BrowserWindow({
    width: windowBounds.width || 1200,
    height: windowBounds.height || 800,
    x: windowBounds.x,
    y: windowBounds.y,
    minWidth: 400,
    minHeight: 300,
    title: "Messenger",
    icon: path.join(__dirname, "icon.png"),
    backgroundColor: settings.isDarkMode ? "#242526" : "#ffffff",
    show: !settings.startMinimized,
    autoHideMenuBar: true,
    titleBarOverlay: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      spellcheck: false,
    },
  });

  app.on("session-created", (sess) => {
    // Setup download handler on every new session
    setupDownloadHandler(sess);

    sess.webRequest.onBeforeRequest(
      { urls: ["*://*.facebook.com/*", "*://*.messenger.com/*"] },
      (details, callback) => {
        let cancel = false;

        // Block Seen
        if (settings.blockSeen) {
          if (
            details.url.includes("/change_read_status.php") ||
            details.url.includes("/ajax/mercury/change_read_status.php")
          ) {
            cancel = true;
          }
          if (details.uploadData && details.uploadData.length > 0) {
            const body = details.uploadData[0].bytes
              ? details.uploadData[0].bytes.toString()
              : "";
            if (
              body.includes("LSThreadMarkRead") ||
              body.includes("markThreadRead") ||
              body.includes("ThreadMarkReadMutation") ||
              body.includes('"name":"mark_read"')
            ) {
              cancel = true;
            }
          }
        }

        // Block Typing
        if (settings.blockTyping) {
          if (
            details.url.includes("/typ.php") ||
            details.url.includes("/ajax/messaging/typ.php")
          ) {
            cancel = true;
          }
          if (details.uploadData && details.uploadData.length > 0) {
            const body = details.uploadData[0].bytes
              ? details.uploadData[0].bytes.toString()
              : "";
            if (
              body.includes("TypingIndicator") ||
              body.includes("LSTypingIndicator") ||
              body.includes("typing_indicator")
            ) {
              cancel = true;
            }
          }
        }

        callback({ cancel });
      },
    );

    sess.setPermissionRequestHandler((webContents, permission, callback) => {
      const url = webContents.getURL();
      if (isTrusted(url)) {
        const allowedPermissions = [
          "notifications",
          "media",
          "mediaKeySystem",
          "microphone",
          "camera",
          "clipboard-read",
          "clipboard-sanitized-write",
        ];
        if (allowedPermissions.includes(permission)) {
          callback(true);
          return;
        }
      }
      callback(false);
    });

    sess.setPermissionCheckHandler((webContents, permission) => {
      const url = webContents?.getURL() || "";
      return isTrusted(url);
    });
  });

  // Strict Content-Security-Policy for the local shell content.
  // Applied to the default session only — the Messenger views run on their
  // own partition sessions and are intentionally unaffected. The absence of
  // 'unsafe-inline' in script-src is what stops injected inline handlers or
  // <script> from ever executing (defense-in-depth behind not rendering
  // untrusted data as HTML).
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'self' file:; " +
            "script-src 'self' file:; " +
            "style-src 'self' 'unsafe-inline'; " +
            "img-src 'self' file: data: https:; " +
            "font-src 'self' data:; " +
            "connect-src 'self'; " +
            "object-src 'none'; " +
            "base-uri 'none'; " +
            "frame-ancestors 'none';",
        ],
      },
    });
  });

  mainWindow.loadFile("index.html");

  if (app.isPackaged) {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key === "I")
      )
        event.preventDefault();
    });
    mainWindow.webContents.on("devtools-opened", () =>
      mainWindow.webContents.closeDevTools(),
    );
  } else {
    mainWindow.webContents.on("before-input-event", (event, input) => {
      if (
        input.key === "F12" ||
        (input.control && input.shift && input.key === "I")
      )
        mainWindow.webContents.toggleDevTools();
    });
  }

  mainWindow.on("resize", updateBrowserViewBounds);
  mainWindow.on("maximize", updateBrowserViewBounds);
  mainWindow.on("unmaximize", updateBrowserViewBounds);

  mainWindow.on("close", (event) => {
    if (!isQuitting && settings.minimizeToTray) {
      event.preventDefault();
      mainWindow.hide();
      return;
    }
    settings.windowBounds = mainWindow.getBounds();
    saveSettings(settings);
  });

  // IPC
  ipcMain.on("switch-profile", (event, profile) => {
    activeProfileId = profile.id;
    if (!browserViews[profile.id]) {
      const view = new WebContentsView({
        webPreferences: {
          // Untrusted Messenger content: no preload, no Node, sandboxed,
          // isolated per-profile partition.
          partition: profile.partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      browserViews[profile.id] = view;
      setupWebContents(view.webContents, profile.id);
      view.webContents.loadURL(MESSENGER_URL, { userAgent: USER_AGENT });
    }
    showView(browserViews[profile.id]);
  });

  // ── Log out / clear the session for a single profile ──
  ipcMain.on("logout-profile", async (event, profileData) => {
    const { id, partition } = profileData;
    try {
      // 1. Destroy the view if it exists
      if (browserViews[id]) {
        detachView(browserViews[id]);
        destroyViewContents(browserViews[id]);
        delete browserViews[id];
      }

      // 2. Wipe cookies + cache + storage for the partition
      const sess = session.fromPartition(partition);
      await sess.clearStorageData({
        storages: [
          "cookies",
          "localstorage",
          "sessionstorage",
          "cachestorage",
          "indexdb",
          "shadercache",
          "websql",
          "serviceworkers",
        ],
      });
      await sess.clearCache();
      await sess.clearAuthCache();

      // 3. Recreate the view with a clean session
      const view = new WebContentsView({
        webPreferences: {
          // Untrusted Messenger content: no preload, no Node, sandboxed.
          partition: partition,
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      browserViews[id] = view;
      setupWebContents(view.webContents, id);
      view.webContents.loadURL(MESSENGER_URL, { userAgent: USER_AGENT });

      // 4. Show it again
      if (activeProfileId === id) {
        showView(view);
      }

      event.reply("logout-profile-done", { id, success: true });
    } catch (err) {
      event.reply("logout-profile-done", {
        id,
        success: false,
        error: err.message,
      });
    }
  });

  // ── Wipe the session when creating a new profile (avoid reusing old cookies) ──
  ipcMain.on("clear-new-profile-session", async (event, partition) => {
    try {
      const sess = session.fromPartition(partition);
      await sess.clearStorageData({
        storages: [
          "cookies",
          "localstorage",
          "sessionstorage",
          "cachestorage",
          "indexdb",
          "shadercache",
          "websql",
          "serviceworkers",
        ],
      });
      await sess.clearCache();
    } catch (err) {}
  });

  ipcMain.on("set-browserview-visibility", (event, visible) => {
    if (!mainWindow) return;
    if (visible && activeProfileId && browserViews[activeProfileId]) {
      showView(browserViews[activeProfileId]);
    } else {
      showView(null);
    }
  });

  ipcMain.on("delete-profile", (event, id) => {
    if (browserViews[id]) {
      detachView(browserViews[id]);
      destroyViewContents(browserViews[id]);
      delete browserViews[id];
    }
  });

  ipcMain.on("update-badge", (event, count) => {
    if (count !== unreadCount) {
      unreadCount = count;
      updateBadge(unreadCount);
    }
  });

  ipcMain.on("set-theme", (event, isDark) => {
    settings.isDarkMode = isDark;
    saveSettings(settings);
    nativeTheme.themeSource = isDark ? "dark" : "light";
  });

  ipcMain.on("toggle-always-on-top", () => {
    settings.alwaysOnTop = !settings.alwaysOnTop;
    mainWindow.setAlwaysOnTop(settings.alwaysOnTop);
    saveSettings(settings);
  });

  ipcMain.on("toggle-fullscreen", () => {
    mainWindow.setFullScreen(!mainWindow.isFullScreen());
    setTimeout(updateBrowserViewBounds, 100);
  });

  ipcMain.on("zoom-in", () => {
    if (activeProfileId && browserViews[activeProfileId]) {
      const wc = browserViews[activeProfileId].webContents;
      wc.setZoomLevel(wc.getZoomLevel() + 0.5);
    }
  });

  ipcMain.on("zoom-out", () => {
    if (activeProfileId && browserViews[activeProfileId]) {
      const wc = browserViews[activeProfileId].webContents;
      wc.setZoomLevel(wc.getZoomLevel() - 0.5);
    }
  });

  ipcMain.on("reload-page", () => {
    if (activeProfileId && browserViews[activeProfileId]) {
      browserViews[activeProfileId].webContents.reload();
    }
  });

  ipcMain.on("go-home", () => {
    if (activeProfileId && browserViews[activeProfileId]) {
      browserViews[activeProfileId].webContents.loadURL(MESSENGER_URL, {
        userAgent: USER_AGENT,
      });
    }
  });

  ipcMain.on("go-back", () => {
    if (activeProfileId && browserViews[activeProfileId]) {
      const wc = browserViews[activeProfileId].webContents;
      if (wc.canGoBack()) wc.goBack();
    }
  });

  ipcMain.on("get-settings", (event) => {
    event.returnValue = {
      isDarkMode: settings.isDarkMode,
      alwaysOnTop: settings.alwaysOnTop,
      appLockEnabled: settings.appLockEnabled,
      appLockTimeout: settings.appLockTimeout,
    };
  });

  // App-lock: hashing/verification happen here; the hash never leaves main.
  ipcMain.handle("applock:setup", (event, pin) => {
    if (!isShellSender(event)) return false;
    if (!/^\d{4}$/.test(String(pin ?? ""))) return false;
    settings.appLockHash = makePinHash(String(pin));
    settings.appLockEnabled = true;
    saveSettings(settings);
    return true;
  });

  ipcMain.handle("applock:verify", (event, pin) => {
    if (!isShellSender(event)) return false;
    if (Date.now() < pinLockUntil) return false; // in cooldown
    const ok = verifyPinHash(String(pin ?? ""), settings.appLockHash);
    if (ok) {
      pinFailCount = 0;
      // Transparently upgrade a legacy sha256 hash to scrypt on success.
      if (settings.appLockHash && !settings.appLockHash.startsWith("scrypt$")) {
        settings.appLockHash = makePinHash(String(pin));
        saveSettings(settings);
      }
    } else {
      pinFailCount++;
      if (pinFailCount >= 10) {
        pinLockUntil = Date.now() + 30000; // 30s lockout after 10 fails
        pinFailCount = 0;
      }
    }
    return ok;
  });

  ipcMain.on("applock:disable", (event) => {
    if (!isShellSender(event)) return;
    settings.appLockEnabled = false;
    settings.appLockHash = "";
    saveSettings(settings);
  });

  ipcMain.on("applock:set-timeout", (event, minutes) => {
    if (!isShellSender(event)) return;
    const m = parseInt(minutes, 10);
    if (Number.isFinite(m) && m >= 0) {
      settings.appLockTimeout = m;
      saveSettings(settings);
    }
  });

  // External links, validated (http/https/mailto only).
  ipcMain.on("open-external", (event, url) => {
    if (isShellSender(event)) safeOpenExternal(url);
  });

  ipcMain.on("get-lock-settings", (event) => {
    event.returnValue = {
      enabled: settings.appLockEnabled,
      timeout: settings.appLockTimeout,
    };
  });

  // ── Download IPC handlers ──
  // Resolve a download id to the sanitized path the app actually wrote,
  // re-validating containment. Never accept a renderer-supplied path.
  function resolveDownloadPath(id) {
    const active = activeDownloads.get(id);
    const p = completedDownloads.get(id) || (active && active.savePath);
    if (p && containedInDownloads(p) && fs.existsSync(p)) return p;
    return null;
  }

  ipcMain.on("open-download-file", (event, id) => {
    if (!isShellSender(event)) return;
    const p = resolveDownloadPath(id);
    if (p) shell.openPath(p);
  });

  ipcMain.on("open-download-folder", (event, id) => {
    if (!isShellSender(event)) return;
    const p = resolveDownloadPath(id);
    if (p) shell.showItemInFolder(p);
    else shell.openPath(app.getPath("downloads"));
  });

  ipcMain.on("cancel-download", (event, id) => {
    const dl = activeDownloads.get(id);
    if (dl && dl.item) {
      dl.item.cancel();
      activeDownloads.delete(id);
    }
  });
}

// ============================================================
//  UPDATE BADGE ON DOCK & TRAY
// ============================================================
function updateBadge(count) {
  if (!mainWindow) return;
  if (app.dock) {
    app.dock.setBadge(count > 0 ? String(count) : "");
  }
  if (tray) {
    tray.setToolTip(count > 0 ? `Messy — ${count} unread` : "Messy");
  }
}

// ============================================================
//  REGISTER GLOBAL SHORTCUTS
// ============================================================
function registerGlobalShortcuts() {
  const hotkey = settings.globalHotkey || "Ctrl+Shift+M";
  try {
    globalShortcut.register(hotkey, () => {
      if (!mainWindow) return;
      if (mainWindow.isVisible() && mainWindow.isFocused()) {
        mainWindow.hide();
      } else {
        mainWindow.show();
        mainWindow.focus();
      }
    });
  } catch (err) {}
}

// ============================================================
//  APP STARTUP
// ============================================================
function setupAppMenu() {
  // Minimal native macOS menu. Without an application menu the standard
  // Cmd+C / Cmd+V / Cmd+A / Cmd+Q shortcuts do not work inside the
  // Messenger view.
  const template = [
    { role: "appMenu" },
    { role: "editMenu" },
    {
      label: "Window",
      submenu: [
        { role: "minimize" },
        // Cmd+W closes (hides) the window; the app keeps running in the dock.
        { role: "close", label: "Close Window" },
        { role: "zoom" },
        { role: "front" },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

app.whenReady().then(() => {
  setupAppMenu();
  nativeTheme.themeSource = settings.isDarkMode ? "dark" : "light";
  createWindow();
  createTray();
  registerGlobalShortcuts();
  setupAutoUpdater();

  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.show();
      mainWindow.focus();
    }
  });

  app.on("activate", () => {
    // Clicking the dock icon re-opens the app. If the window was hidden
    // (Cmd+W / red button / minimize-to-tray) it still exists, so show and
    // focus it; only recreate when it was genuinely destroyed.
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.show();
      mainWindow.focus();
    } else {
      createWindow();
    }
  });
});

// ============================================================
//  QUIT HANDLING
// ============================================================
app.on("before-quit", () => {
  isQuitting = true;
  if (mainWindow) {
    settings.windowBounds = mainWindow.getBounds();
    saveSettings(settings);
  }
});

app.on("will-quit", () => {
  globalShortcut.unregisterAll();
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

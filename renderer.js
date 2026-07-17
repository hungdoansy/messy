// All privileged capability comes through the vetted window.messy bridge
// (see preload.js). This renderer has no Node access: no require, no fs,
// no ipcRenderer. `messy` (window.messy) is the only channel to the main
// process; it is a global created by contextBridge, used directly below.
const profilesList = document.getElementById("profiles-list");
const scrollUpBtn = document.getElementById("scroll-up");
const scrollDownBtn = document.getElementById("scroll-down");

// Load profiles
let profiles = [];
try {
  const saved = localStorage.getItem("mp_profiles");
  if (saved) profiles = JSON.parse(saved);
} catch (e) {}

if (profiles.length === 0) {
  profiles = [
    { id: Date.now().toString(), name: "Account 1", partition: "persist:nick_1" },
  ];
  saveProfiles();
}

let activeProfileId = profiles[0].id;

function saveProfiles() {
  localStorage.setItem("mp_profiles", JSON.stringify(profiles));
}

// ============================================================
//  SCROLL ARROWS & DRAG SCROLL
// ============================================================
function updateScrollArrows() {
  if (!profilesList) return;
  const canScrollUp = profilesList.scrollTop > 0;
  const canScrollDown =
    profilesList.scrollTop + profilesList.clientHeight <
    profilesList.scrollHeight - 1;

  scrollUpBtn.classList.toggle("visible", canScrollUp);
  scrollDownBtn.classList.toggle("visible", canScrollDown);
}

// Scroll arrow buttons
let scrollInterval = null;
function startScrolling(direction) {
  stopScrolling();
  const step = direction === "up" ? -4 : 4;
  scrollInterval = setInterval(() => {
    profilesList.scrollTop += step;
    updateScrollArrows();
  }, 16);
}
function stopScrolling() {
  if (scrollInterval) {
    clearInterval(scrollInterval);
    scrollInterval = null;
  }
}

scrollUpBtn.addEventListener("mousedown", () => startScrolling("up"));
scrollUpBtn.addEventListener("mouseup", stopScrolling);
scrollUpBtn.addEventListener("mouseleave", stopScrolling);
scrollDownBtn.addEventListener("mousedown", () => startScrolling("down"));
scrollDownBtn.addEventListener("mouseup", stopScrolling);
scrollDownBtn.addEventListener("mouseleave", stopScrolling);

// Click to scroll by one item
scrollUpBtn.addEventListener("click", () => {
  profilesList.scrollBy({ top: -50, behavior: "smooth" });
  setTimeout(updateScrollArrows, 300);
});
scrollDownBtn.addEventListener("click", () => {
  profilesList.scrollBy({ top: 50, behavior: "smooth" });
  setTimeout(updateScrollArrows, 300);
});

// Mouse drag scrolling on profiles list
let isDragging = false;
let dragStartY = 0;
let dragScrollTop = 0;

profilesList.addEventListener("mousedown", (e) => {
  // Only start drag if clicking on the list itself or between items
  isDragging = true;
  dragStartY = e.clientY;
  dragScrollTop = profilesList.scrollTop;
  profilesList.classList.add("dragging");
});

document.addEventListener("mousemove", (e) => {
  if (!isDragging) return;
  e.preventDefault();
  const diff = dragStartY - e.clientY;
  profilesList.scrollTop = dragScrollTop + diff;
  updateScrollArrows();
});

document.addEventListener("mouseup", () => {
  if (isDragging) {
    isDragging = false;
    profilesList.classList.remove("dragging");
  }
});

// Mouse wheel scroll
profilesList.addEventListener(
  "wheel",
  (e) => {
    e.preventDefault();
    profilesList.scrollTop += e.deltaY > 0 ? 50 : -50;
    updateScrollArrows();
  },
  { passive: false },
);

// Update arrows on content changes
const resizeObserver = new ResizeObserver(updateScrollArrows);
resizeObserver.observe(profilesList);

// ============================================================
//  RENDER SIDEBAR
// ============================================================
function renderSidebar() {
  profilesList.innerHTML = "";
  profiles.forEach((p) => {
    const btn = document.createElement("div");
    btn.className = `profile-btn ${p.id === activeProfileId ? "active" : ""}`;
    btn.title = p.name + " (Right-click to rename/delete)";

    const span = document.createElement("span");
    span.innerText = p.name.charAt(0).toUpperCase();

    // Add avatar image if exists
    if (p.avatar) {
      const img = document.createElement("img");
      img.src = p.avatar.startsWith("http")
        ? p.avatar
        : `file://${p.avatar.replace(/\\/g, "/")}`;
      img.style.width = "100%";
      img.style.height = "100%";
      img.style.borderRadius = "50%";
      img.style.objectFit = "cover";
      img.style.position = "absolute";
      img.style.top = "0";
      img.style.left = "0";
      btn.appendChild(img);
      span.style.display = "none";
    } else {
      btn.appendChild(span);
    }

    const badge = document.createElement("div");
    badge.className = "badge";
    badge.id = `badge-${p.id}`;
    badge.innerText = "0";
    btn.appendChild(badge);

    btn.onclick = () => switchProfile(p.id);

    btn.oncontextmenu = () => {
      openModal(p);
    };

    profilesList.appendChild(btn);
  });

  // Update scroll arrows after rendering
  setTimeout(updateScrollArrows, 50);
}

function switchProfile(id) {
  activeProfileId = id;
  renderSidebar();
  const p = profiles.find((x) => x.id === id);
  if (p) {
    messy.switchProfile(p);
  }
}

// ============================================================
//  MODAL LOGIC
// ============================================================
let editingProfile = null;
let tempAvatarPath = null;
const modalOverlay = document.getElementById("modal-overlay");
const modalTitle = document.getElementById("modal-title");
const nameInput = document.getElementById("profile-name-input");
const avatarPreview = document.getElementById("avatar-preview");
const avatarImg = document.getElementById("avatar-img");
const avatarLetter = document.getElementById("avatar-letter");
const avatarInput = document.getElementById("avatar-input");

function openModal(profileToEdit = null) {
  messy.setBrowserViewVisibility(false);
  editingProfile = profileToEdit;
  tempAvatarPath = profileToEdit ? profileToEdit.avatar : null;

  modalTitle.innerText = profileToEdit ? "Edit account" : "Add account";
  nameInput.value = profileToEdit ? profileToEdit.name : "";
  document.getElementById("modal-delete").style.display = profileToEdit
    ? "block"
    : "none";
  document.getElementById("modal-logout").style.display = profileToEdit
    ? "flex"
    : "none";

  updateAvatarPreview();
  modalOverlay.style.display = "flex";
  nameInput.focus();
}

function updateAvatarPreview() {
  if (tempAvatarPath) {
    avatarImg.src = tempAvatarPath.startsWith("http")
      ? tempAvatarPath
      : `file://${tempAvatarPath.replace(/\\/g, "/")}`;
    avatarImg.style.display = "block";
    avatarLetter.style.display = "none";
  } else {
    avatarImg.style.display = "none";
    avatarLetter.style.display = "block";
    avatarLetter.innerText = nameInput.value
      ? nameInput.value.charAt(0).toUpperCase()
      : "+";
  }
}

nameInput.addEventListener("input", updateAvatarPreview);

avatarPreview.onclick = () => avatarInput.click();
document.getElementById("avatar-pick-label").onclick = () => avatarInput.click();
avatarInput.onchange = (e) => {
  if (e.target.files && e.target.files[0]) {
    tempAvatarPath = messy.getPathForFile(e.target.files[0]);
    updateAvatarPreview();
  }
};

document.getElementById("modal-delete").onclick = () => {
  if (!editingProfile) return;
  const action = confirm(
    `Are you sure you want to DELETE the account [${editingProfile.name}]?`,
  );
  if (action) {
    if (profiles.length <= 1) {
      alert("You must have at least 1 account!");
      return;
    }
    profiles = profiles.filter((x) => x.id !== editingProfile.id);
    saveProfiles();
    messy.deleteProfile(editingProfile.id);
    if (activeProfileId === editingProfile.id) switchProfile(profiles[0].id);
    modalOverlay.style.display = "none";
    renderSidebar();
    messy.setBrowserViewVisibility(true);
  }
};

document.getElementById("modal-cancel").onclick = () => {
  modalOverlay.style.display = "none";
  messy.setBrowserViewVisibility(true);
};

document.getElementById("modal-save").onclick = () => {
  const name = nameInput.value.trim();
  if (!name) {
    alert("Please enter an account name!");
    return;
  }

  if (editingProfile) {
    editingProfile.name = name;
    editingProfile.avatar = tempAvatarPath;
  } else {
    // Use a crypto UUID to avoid ID collisions
    const id =
      self.crypto && self.crypto.randomUUID
        ? self.crypto.randomUUID()
        : Date.now().toString() + "_" + Math.random().toString(36).slice(2);
    const partition = `persist:nick_${id}`;
    const p = { id, name, avatar: tempAvatarPath, partition };
    // Wipe any existing old session (ensure old cookies aren't reused)
    messy.clearNewProfileSession(partition);
    profiles.push(p);
    activeProfileId = id;
  }

  saveProfiles();
  modalOverlay.style.display = "none";
  renderSidebar();
  messy.setBrowserViewVisibility(true);
  if (!editingProfile) switchProfile(activeProfileId);
};

// ── Log out & re-login button ──
document.getElementById("modal-logout").onclick = () => {
  if (!editingProfile) return;
  const profileName = editingProfile.name;
  const action = confirm(
    `Are you sure you want to LOG OUT the account [${profileName}]?\n\nThis clears all cookies/session and lets you log in with a different account.`,
  );
  if (!action) return;

  const logoutBtn = document.getElementById("modal-logout");
  logoutBtn.classList.add("loading");
  logoutBtn.innerHTML =
    '<svg viewBox="0 0 24 24" style="animation:spin 1s linear infinite"><path d="M23 4v6h-6"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> Logging out...';

  // Clear avatar cache
  editingProfile.avatar = null;
  saveProfiles();

  messy.logoutProfile({
    id: editingProfile.id,
    partition: editingProfile.partition,
  });
};

// Receive the logout result
messy.onLogoutDone(({ id, success }) => {
  const logoutBtn = document.getElementById("modal-logout");
  if (success) {
    logoutBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> ✅ Logged out!';
    logoutBtn.style.color = "#51cf66";
    logoutBtn.style.borderColor = "#51cf66";
    setTimeout(() => {
      modalOverlay.style.display = "none";
      logoutBtn.classList.remove("loading");
      logoutBtn.style.color = "";
      logoutBtn.style.borderColor = "";
      renderSidebar();
      messy.setBrowserViewVisibility(true);
    }, 800);
  } else {
    logoutBtn.innerHTML =
      '<svg viewBox="0 0 24 24"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg> ❌ Error! Try again';
    logoutBtn.classList.remove("loading");
  }
});

document.getElementById("btn-add-profile").onclick = () => openModal();

// ============================================================
//  RIGHT SIDEBAR TOOLBAR
// ============================================================
let isDarkMode = true;
const toggleDarkMode = () => {
  isDarkMode = !isDarkMode;
  document.body.className = isDarkMode ? "dark-mode" : "light-mode";
  document.getElementById("icon-sun").style.display = isDarkMode
    ? "none"
    : "block";
  document.getElementById("icon-moon").style.display = isDarkMode
    ? "block"
    : "none";
  messy.setTheme(isDarkMode);
};
document.getElementById("btn-dark-mode").onclick = toggleDarkMode;
document.getElementById("btn-zoom-in").onclick = () => messy.zoomIn();
document.getElementById("btn-zoom-out").onclick = () => messy.zoomOut();
document.getElementById("btn-fs").onclick = () => messy.toggleFullscreen();
document.getElementById("btn-pin").onclick = () => {
  const btn = document.getElementById("btn-pin");
  const isPinned = btn.style.opacity === "1";
  btn.style.opacity = isPinned ? "0.4" : "1";
  messy.toggleAlwaysOnTop();
};
document.getElementById("btn-reload").onclick = () => messy.reloadPage();
document.getElementById("btn-home").onclick = () => messy.goHome();
document.getElementById("btn-back").onclick = () => messy.goBack();
document.getElementById("btn-j2team").onclick = () => {
  messy.openExternal(
    "https://chromewebstore.google.com/detail/j2team-security/hmlcjjclebjnfohgmgikjfnbmfkigocc",
  );
};

// Lock button — click: lock, right-click: settings
document.getElementById("btn-lock").onclick = () => {
  const ls = messy.getLockSettings();
  if (ls.enabled) {
    lockApp("verify");
  } else {
    lockApp("setup");
  }
};
document.getElementById("btn-lock").oncontextmenu = (e) => {
  e.preventDefault();
  openLockSettings();
};

// ============================================================
//  IPC UPDATES FROM MAIN
// ============================================================
let profileBadgeCounts = {};

messy.onProfileBadge(({ id, count }) => {
  const badge = document.getElementById(`badge-${id}`);
  if (badge) {
    badge.innerText = count > 9 ? "9+" : count;
    badge.style.display = count > 0 ? "block" : "none";
  }
  profileBadgeCounts[id] = count || 0;
  const totalCount = Object.values(profileBadgeCounts).reduce(
    (a, b) => a + b,
    0,
  );
  messy.updateBadge(totalCount);
});

messy.onProfileAvatar(({ id, avatarUrl }) => {
  const p = profiles.find((x) => x.id === id);
  if (p) {
    const isAutoAvatar =
      !p.avatar ||
      p.avatar.includes("graph.facebook.com") ||
      p.avatar.includes("scontent") ||
      p.avatar.includes("fbcdn");
    if (isAutoAvatar && p.avatar !== avatarUrl) {
      p.avatar = avatarUrl;
      saveProfiles();
      renderSidebar();
    }
  }
});

// ============================================================
//  INIT
// ============================================================
const settings = messy.getSettings();
isDarkMode = settings.isDarkMode;
document.body.className = isDarkMode ? "dark-mode" : "light-mode";
document.getElementById("icon-sun").style.display = isDarkMode
  ? "none"
  : "block";
document.getElementById("icon-moon").style.display = isDarkMode
  ? "block"
  : "none";
if (settings.alwaysOnTop) {
  document.getElementById("btn-pin").style.opacity = "1";
}

renderSidebar();
switchProfile(activeProfileId);

// ============================================================
//  APP LOCK MODULE
// ============================================================
const lockScreen = document.getElementById("lock-screen");
const pinDotsContainer = document.getElementById("pin-dots");
const lockMessage = document.getElementById("lock-message");
const pinKeys = document.querySelectorAll(".pin-key[data-key]");
const lockDisableBtn = document.getElementById("lock-disable-btn");

const lock = {
  mode: "verify", // 'verify' | 'setup' | 'confirm'
  enteredPin: "",
  setupPin: "",
  wrongAttempts: 0,
  idleTimer: null,
  isLocked: false,
};

function lockApp(mode) {
  lock.mode = mode || "verify";
  lock.enteredPin = "";
  lock.setupPin = "";
  lock.isLocked = true;
  lockScreen.classList.add("active");
  messy.setBrowserViewVisibility(false);
  updatePinDots();

  if (mode === "setup") {
    lockMessage.textContent = "Create a new PIN (4 digits)";
    lockMessage.className = "lock-subtitle";
    lockDisableBtn.style.display = "none";
  } else {
    lockMessage.textContent = "Enter PIN to unlock";
    lockMessage.className = "lock-subtitle";
    lockDisableBtn.style.display = "none";
  }
}

function unlockApp() {
  lock.isLocked = false;
  lock.enteredPin = "";
  lock.wrongAttempts = 0;
  lockScreen.classList.remove("active");
  messy.setBrowserViewVisibility(true);
  resetIdleTimer();
}

function updatePinDots() {
  const dots = pinDotsContainer.querySelectorAll(".pin-dot");
  dots.forEach((dot, i) => {
    dot.classList.toggle("filled", i < lock.enteredPin.length);
  });
}

function handlePinKey(key) {
  if (key === "delete") {
    lock.enteredPin = lock.enteredPin.slice(0, -1);
    updatePinDots();
    return;
  }
  if (lock.enteredPin.length >= 4) return;
  lock.enteredPin += key;
  updatePinDots();
  if (lock.enteredPin.length === 4) {
    setTimeout(handlePinComplete, 200);
  }
}

async function handlePinComplete() {
  if (lock.mode === "setup") {
    // Step 1: Save first entry
    lock.setupPin = lock.enteredPin;
    lock.enteredPin = "";
    lock.mode = "confirm";
    lockMessage.textContent = "Confirm your PIN";
    lockMessage.className = "lock-subtitle";
    updatePinDots();
  } else if (lock.mode === "confirm") {
    // Step 2: Confirm PIN match
    if (lock.enteredPin === lock.setupPin) {
      // Hashing happens in the main process; the hash never reaches here.
      await messy.setupPin(lock.enteredPin);
      lockMessage.textContent = "✅ PIN set!";
      lockMessage.className = "lock-subtitle success";
      setTimeout(unlockApp, 700);
    } else {
      lockMessage.textContent = "Doesn't match! Start over";
      lockMessage.className = "lock-subtitle error";
      pinDotsContainer.classList.add("shake");
      setTimeout(() => {
        pinDotsContainer.classList.remove("shake");
        lock.mode = "setup";
        lock.enteredPin = "";
        lock.setupPin = "";
        lockMessage.textContent = "Create a new PIN (4 digits)";
        lockMessage.className = "lock-subtitle";
        updatePinDots();
      }, 600);
    }
  } else if (lock.mode === "verify") {
    // Verify PIN — comparison happens in the main process.
    const ok = await messy.verifyPin(lock.enteredPin);
    if (ok) {
      lockMessage.textContent = "✅ Unlocked!";
      lockMessage.className = "lock-subtitle success";
      setTimeout(unlockApp, 300);
    } else {
      lock.wrongAttempts++;
      lockMessage.textContent = `Wrong PIN! (${lock.wrongAttempts}/5)`;
      lockMessage.className = "lock-subtitle error";
      pinDotsContainer.classList.add("shake");
      lock.enteredPin = "";
      setTimeout(() => {
        pinDotsContainer.classList.remove("shake");
        updatePinDots();
      }, 500);

      if (lock.wrongAttempts >= 5) {
        lockMessage.textContent = "Too many wrong attempts. Wait 30 seconds...";
        pinKeys.forEach((k) => (k.disabled = true));
        setTimeout(() => {
          lock.wrongAttempts = 0;
          lockMessage.textContent = "Enter PIN to unlock";
          lockMessage.className = "lock-subtitle";
          pinKeys.forEach((k) => (k.disabled = false));
        }, 30000);
      }
    }
  }
}

// PIN pad click handlers
pinKeys.forEach((btn) => {
  btn.addEventListener("click", () => {
    const key = btn.getAttribute("data-key");
    if (key) handlePinKey(key);
  });
});

// Keyboard support on lock screen
document.addEventListener("keydown", (e) => {
  if (!lock.isLocked) return;
  if (e.key >= "0" && e.key <= "9") handlePinKey(e.key);
  else if (e.key === "Backspace") handlePinKey("delete");
});

// Lock disable button (shown in footer)
lockDisableBtn.onclick = () => {
  if (confirm("Are you sure you want to disable the app lock?")) {
    messy.disableLock();
    unlockApp();
  }
};

// ============================================================
//  LOCK SETTINGS MODAL
// ============================================================
const lockSettingsOverlay = document.getElementById("lock-settings-overlay");
const lsToggle = document.getElementById("ls-toggle-lock");
const lsTimeout = document.getElementById("ls-timeout");
const lsChangePin = document.getElementById("ls-change-pin");
const lsRemovePin = document.getElementById("ls-remove-pin");

function openLockSettings() {
  const ls = messy.getLockSettings();
  lsToggle.classList.toggle("on", ls.enabled);
  lsTimeout.value = String(ls.timeout || 5);
  lsChangePin.style.display = ls.enabled ? "block" : "none";
  lsRemovePin.style.display = ls.enabled ? "block" : "none";
  lockSettingsOverlay.style.display = "flex";
  messy.setBrowserViewVisibility(false);
}

lsToggle.onclick = () => {
  const ls = messy.getLockSettings();
  if (!ls.enabled) {
    // Enable: show setup PIN
    lockSettingsOverlay.style.display = "none";
    lockApp("setup");
  } else {
    // Disable
    messy.disableLock();
    lsToggle.classList.remove("on");
    lsChangePin.style.display = "none";
    lsRemovePin.style.display = "none";
  }
};

lsTimeout.onchange = () => {
  messy.setLockTimeout(parseInt(lsTimeout.value));
  resetIdleTimer();
};

lsChangePin.onclick = () => {
  lockSettingsOverlay.style.display = "none";
  lockApp("setup");
};

lsRemovePin.onclick = () => {
  if (confirm("Remove PIN? The app lock will be disabled.")) {
    messy.disableLock();
    lockSettingsOverlay.style.display = "none";
    messy.setBrowserViewVisibility(true);
    lsToggle.classList.remove("on");
  }
};

document.getElementById("ls-close").onclick = () => {
  lockSettingsOverlay.style.display = "none";
  messy.setBrowserViewVisibility(true);
};

// ============================================================
//  IDLE DETECTION — Auto-lock after timeout
// ============================================================
function resetIdleTimer() {
  if (lock.idleTimer) clearTimeout(lock.idleTimer);
  const ls = messy.getLockSettings();
  if (ls.enabled && ls.timeout > 0) {
    lock.idleTimer = setTimeout(
      () => {
        if (!lock.isLocked) lockApp("verify");
      },
      ls.timeout * 60 * 1000,
    );
  }
}

["mousemove", "mousedown", "keydown", "scroll", "touchstart"].forEach((evt) => {
  document.addEventListener(
    evt,
    () => {
      if (!lock.isLocked) resetIdleTimer();
    },
    { passive: true },
  );
});

// ============================================================
//  INIT LOCK — Lock on startup if enabled
// ============================================================
if (settings.appLockEnabled) {
  lockApp("verify");
}
resetIdleTimer();

// ============================================================
//  DOWNLOAD MANAGER MODULE
// ============================================================
const dlPanel = document.getElementById("download-panel");
const dlList = document.getElementById("dl-list");
const dlCount = document.getElementById("dl-count");
const dlEmpty = document.getElementById("dl-empty");
const dlToast = document.getElementById("dl-toast");

let downloads = []; // { id, filename, savePath, total, received, state, done }
let dlPanelOpen = false;

// Toggle download panel
document.getElementById("btn-download").onclick = () => {
  dlPanelOpen = !dlPanelOpen;
  dlPanel.style.display = dlPanelOpen ? "flex" : "none";
};
document.getElementById("dl-close").onclick = () => {
  dlPanelOpen = false;
  dlPanel.style.display = "none";
};

// Close panel when clicking outside
document.addEventListener("click", (e) => {
  if (
    dlPanelOpen &&
    !dlPanel.contains(e.target) &&
    e.target.id !== "btn-download" &&
    !e.target.closest("#btn-download")
  ) {
    dlPanelOpen = false;
    dlPanel.style.display = "none";
  }
});

function formatBytes(bytes) {
  if (!bytes || bytes === 0) return "0 B";
  const k = 1024;
  const sizes = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i];
}

function getFileIcon(filename) {
  const ext = (filename.split(".").pop() || "").toLowerCase();
  const icons = {
    jpg: "🖼️",
    jpeg: "🖼️",
    png: "🖼️",
    gif: "🖼️",
    webp: "🖼️",
    svg: "🖼️",
    bmp: "🖼️",
    mp4: "🎬",
    avi: "🎬",
    mkv: "🎬",
    mov: "🎬",
    webm: "🎬",
    mp3: "🎵",
    wav: "🎵",
    ogg: "🎵",
    flac: "🎵",
    aac: "🎵",
    pdf: "📄",
    doc: "📝",
    docx: "📝",
    xls: "📊",
    xlsx: "📊",
    ppt: "📊",
    pptx: "📊",
    zip: "📦",
    rar: "📦",
    "7z": "📦",
    tar: "📦",
    gz: "📦",
    exe: "⚙️",
    msi: "⚙️",
    apk: "📱",
    txt: "📃",
    json: "📃",
    csv: "📃",
    xml: "📃",
  };
  return icons[ext] || "📎";
}

function showDlToast(prefix, filename) {
  // Build with DOM nodes so an attacker-controlled filename is inert text,
  // never parsed as HTML.
  dlToast.replaceChildren();
  dlToast.append(prefix + " ");
  const b = document.createElement("b");
  b.textContent = filename || "";
  dlToast.append(b);
  dlToast.classList.add("show");
  setTimeout(() => dlToast.classList.remove("show"), 3000);
}

function renderDownloads() {
  // Update count
  const activeCount = downloads.filter((d) => !d.done).length;
  dlCount.textContent = downloads.length;
  dlCount.style.display = downloads.length > 0 ? "inline" : "none";
  dlEmpty.style.display = downloads.length === 0 ? "block" : "none";

  // Remove existing items (keep empty placeholder)
  dlList.querySelectorAll(".dl-item").forEach((el) => el.remove());

  // Render each download (newest first)
  [...downloads].reverse().forEach((dl) => {
    const item = document.createElement("div");
    item.className = "dl-item";
    item.id = `dl-item-${dl.id}`;

    const pct = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;
    const iconClass = dl.done
      ? dl.state === "completed"
        ? "dl-done"
        : "dl-error"
      : "";
    const statusIcon = dl.done
      ? dl.state === "completed"
        ? "✅"
        : "❌"
      : getFileIcon(dl.filename);
    const statusText = dl.done
      ? dl.state === "completed"
        ? "Completed"
        : dl.state === "cancelled"
          ? "Cancelled"
          : "Error"
      : dl.state === "interrupted"
        ? "Paused"
        : `${pct}%`;
    const sizeText =
      dl.total > 0
        ? `${formatBytes(dl.received)} / ${formatBytes(dl.total)}`
        : dl.received > 0
          ? formatBytes(dl.received)
          : "Downloading...";

    // ── Build the row with DOM nodes (no innerHTML for data) ──
    const iconEl = document.createElement("div");
    iconEl.className = `dl-icon ${iconClass}`.trim();
    iconEl.textContent = statusIcon;

    const info = document.createElement("div");
    info.className = "dl-info";

    const fnEl = document.createElement("div");
    fnEl.className = "dl-filename";
    // Attacker-controlled filename → attribute + text only, never markup.
    fnEl.setAttribute("title", dl.filename);
    fnEl.textContent = dl.filename;

    const meta = document.createElement("div");
    meta.className = "dl-meta";
    const s1 = document.createElement("span");
    s1.textContent = statusText;
    const s2 = document.createElement("span");
    s2.textContent = "·";
    const s3 = document.createElement("span");
    s3.textContent = sizeText;
    meta.append(s1, s2, s3);

    info.append(fnEl, meta);

    if (!dl.done) {
      const bar = document.createElement("div");
      bar.className = "dl-progress-bar";
      const fill = document.createElement("div");
      fill.className = "dl-progress-fill";
      fill.style.width = pct + "%";
      bar.append(fill);
      info.append(bar);
    }

    const actions = document.createElement("div");
    actions.className = "dl-actions";

    // SVG markup below is a constant string (no user data, no script).
    const makeBtn = (svg, title, handler) => {
      const btn = document.createElement("button");
      btn.className = "dl-action-btn";
      btn.title = title;
      btn.innerHTML = svg;
      btn.addEventListener("click", handler);
      return btn;
    };

    if (dl.done && dl.state === "completed") {
      actions.append(
        makeBtn(
          '<svg viewBox="0 0 24 24"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>',
          "Open file",
          () => messy.openDownloadFile(dl.id),
        ),
        makeBtn(
          '<svg viewBox="0 0 24 24"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>',
          "Open folder",
          () => messy.openDownloadFolder(dl.id),
        ),
      );
    } else if (!dl.done) {
      actions.append(
        makeBtn(
          '<svg viewBox="0 0 24 24"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
          "Cancel",
          () => messy.cancelDownload(dl.id),
        ),
      );
    }

    item.append(iconEl, info, actions);
    dlList.insertBefore(item, dlEmpty);
  });
}

// IPC: Download events from main process
messy.onDownloadStarted((data) => {
  downloads.push({
    id: data.id,
    filename: data.filename,
    savePath: data.savePath,
    total: data.total,
    received: 0,
    state: "progressing",
    done: false,
  });
  renderDownloads();
  // Auto-open panel & show toast
  if (!dlPanelOpen) {
    dlPanelOpen = true;
    dlPanel.style.display = "flex";
  }
  showDlToast("⬇️ Download started:", data.filename);
});

messy.onDownloadProgress((data) => {
  const dl = downloads.find((d) => d.id === data.id);
  if (dl) {
    dl.received = data.received;
    dl.total = data.total || dl.total;
    dl.state = data.state;
    // Update progress bar directly for performance
    const fill = document.querySelector(`#dl-item-${dl.id} .dl-progress-fill`);
    const pct = dl.total > 0 ? Math.round((dl.received / dl.total) * 100) : 0;
    if (fill) {
      fill.style.width = pct + "%";
      const metaSpans = document.querySelectorAll(
        `#dl-item-${dl.id} .dl-meta span`,
      );
      if (metaSpans[0]) metaSpans[0].textContent = pct + "%";
      if (metaSpans[2])
        metaSpans[2].textContent = `${formatBytes(dl.received)} / ${formatBytes(dl.total)}`;
    }
  }
});

messy.onDownloadDone((data) => {
  const dl = downloads.find((d) => d.id === data.id);
  if (dl) {
    dl.done = true;
    dl.state = data.state;
    dl.savePath = data.savePath || dl.savePath;
    renderDownloads();
    if (data.state === "completed") {
      showDlToast("✅ Downloaded:", data.filename);
    } else {
      showDlToast("❌ Download failed:", data.filename);
    }
  }
});

// ============================================================
//  ORIGIN TRUST BOUNDARY (pure, dependency-free → unit-testable)
//  Parse the URL and match the *parsed* hostname against an allowlist.
//  Substring checks (url.includes("facebook.com")) are bypassable
//  (evil.com/facebook.com, facebook.com.evil.com) and must not be used.
// ============================================================
const ALLOWED_HOSTS = new Set([
  "facebook.com",
  "www.facebook.com",
  "m.facebook.com",
  "messenger.com",
  "www.messenger.com",
]);

// Top-level navigation trust for the Messenger view.
function isTrusted(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return (
    ALLOWED_HOSTS.has(u.hostname) ||
    u.hostname.endsWith(".facebook.com") ||
    u.hostname.endsWith(".messenger.com") ||
    u.hostname.endsWith(".fbcdn.net")
  );
}

// ============================================================
//  OAUTH LOGIN-POPUP TRUST (popup-scoped, NOT navigation-scoped)
//  "Continue with Google/Apple" opens a login popup on a third-party
//  origin. Those origins are trusted ONLY for opening/navigating that
//  popup — never for top-level navigation of the Messenger view, which
//  stays gated by isTrusted(). Keep these two allowlists separate.
//  Scoped to the exact OAuth entry hosts; add a host here if a provider
//  flow legitimately needs one (verify with a real login first).
// ============================================================
const ALLOWED_POPUP_HOSTS = new Set([
  "accounts.google.com",
  "appleid.apple.com",
]);

function isAllowedPopupHost(url) {
  let u;
  try {
    u = new URL(String(url));
  } catch {
    return false;
  }
  if (u.protocol !== "https:") return false;
  return ALLOWED_POPUP_HOSTS.has(u.hostname);
}

module.exports = { ALLOWED_HOSTS, ALLOWED_POPUP_HOSTS, isTrusted, isAllowedPopupHost };

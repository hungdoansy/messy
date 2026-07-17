// Unit tests for the origin trust boundary (run: `node --test`).
// These functions gate what the Messenger view may navigate to and which
// OAuth login popups are allowed, so their boundary behavior is security
// relevant — substring-lookalike hosts must never be accepted.
const test = require("node:test");
const assert = require("node:assert/strict");
const { isTrusted, isAllowedPopupHost } = require("../trust");

test("isTrusted accepts Facebook/Messenger hosts over https", () => {
  assert.equal(isTrusted("https://www.facebook.com/messages"), true);
  assert.equal(isTrusted("https://facebook.com/"), true);
  assert.equal(isTrusted("https://m.facebook.com/"), true);
  assert.equal(isTrusted("https://www.messenger.com/"), true);
  assert.equal(isTrusted("https://edge-chat.messenger.com/"), true);
  assert.equal(isTrusted("https://scontent.fbcdn.net/x.jpg"), true);
});

test("isTrusted rejects lookalike and substring-bypass hosts", () => {
  assert.equal(isTrusted("https://facebook.com.evil.com/"), false);
  assert.equal(isTrusted("https://evil.com/facebook.com"), false);
  assert.equal(isTrusted("https://notfacebook.com/"), false);
  assert.equal(isTrusted("https://facebook.com.br/"), false);
  assert.equal(isTrusted("https://fbcdn.net.evil.com/"), false);
});

test("isTrusted rejects non-https and malformed URLs", () => {
  assert.equal(isTrusted("http://www.facebook.com/"), false);
  assert.equal(isTrusted("file:///etc/passwd"), false);
  assert.equal(isTrusted("javascript:alert(1)"), false);
  assert.equal(isTrusted("not a url"), false);
  assert.equal(isTrusted(""), false);
  assert.equal(isTrusted(null), false);
  assert.equal(isTrusted(undefined), false);
});

test("isAllowedPopupHost accepts only the exact OAuth entry hosts", () => {
  assert.equal(isAllowedPopupHost("https://accounts.google.com/o/oauth2/auth"), true);
  assert.equal(isAllowedPopupHost("https://appleid.apple.com/auth/authorize"), true);
});

test("isAllowedPopupHost rejects other Google/Apple subdomains and lookalikes", () => {
  // Broader subdomains are intentionally NOT trusted for the login popup.
  assert.equal(isAllowedPopupHost("https://mail.google.com/"), false);
  assert.equal(isAllowedPopupHost("https://google.com/"), false);
  assert.equal(isAllowedPopupHost("https://apple.com/"), false);
  // Lookalike / substring-bypass hosts.
  assert.equal(isAllowedPopupHost("https://accounts.google.com.evil.com/"), false);
  assert.equal(isAllowedPopupHost("https://evil.com/accounts.google.com"), false);
  assert.equal(isAllowedPopupHost("https://notappleid.apple.com.evil.com/"), false);
});

test("isAllowedPopupHost rejects non-https", () => {
  assert.equal(isAllowedPopupHost("http://accounts.google.com/"), false);
  assert.equal(isAllowedPopupHost(""), false);
});

test("popup trust never overlaps top-level navigation trust", () => {
  // The two allowlists must stay disjoint: an OAuth popup host must not be
  // navigable at the top level, and a Messenger host is not a "popup host".
  for (const url of [
    "https://accounts.google.com/",
    "https://appleid.apple.com/",
  ]) {
    assert.equal(isTrusted(url), false, `${url} must not be top-level trusted`);
  }
  for (const url of [
    "https://www.facebook.com/",
    "https://www.messenger.com/",
  ]) {
    assert.equal(isAllowedPopupHost(url), false, `${url} must not be a popup host`);
  }
});

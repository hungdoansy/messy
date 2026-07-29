---
title: Auto-fetched account avatar showed a friend's picture
date: 2026-07-29
problem_type: integration-issues
module: main.js (setupWebContents avatar poller)
severity: medium
tags: [facebook, dom-scraping, avatar, electron, browserview, c_user, heuristics]
---

## Symptom

A profile's sidebar avatar intermittently showed one of that account's *friends* instead of the
account holder. It often looked correct right after launch and then silently changed.

## Root cause

The scraper injected into each BrowserView looked for "the first avatar-sized Facebook-CDN image"
with no tie to the logged-in account:

1. first `div[role="navigation"]` → first `svg image` with a `scontent`/`fbcdn` href
2. any `svg image` in the document
3. any `<img>` 20–100px wide from `scontent`/`fbcdn`

Two facts about `facebook.com/messages` make all three tiers wrong:

- **The conversation/thread list is a `role="navigation"` landmark**, and it comes before the top
  chrome in DOM order. `querySelector` (singular) returns it, so tier 1 searched the friend list.
- **Facebook renders a friend's avatar with markup identical to your own** — same
  `<svg><image xlink:href="…scontent…">`. There is no structural or size signal distinguishing
  them; thread-list and chat-head avatars land squarely in tier 3's 20–100px band too.

So the scrape was effectively "pick whichever avatar is first in the DOM" — usually a friend.
Verified by running the old code against a synthetic DOM: it returned a friend in *every* case,
including when the account's own avatar was present in a `/me/` link.

Two things made it look *intermittent* rather than always-broken:

- The poller ran **every 5s forever**, and `onProfileAvatar` in `renderer.js` overwrites any
  auto-avatar whenever the URL changes. A correct avatar got replaced the moment the DOM shifted
  (opening a thread, scrolling the list, chat heads rendering).
- The `graph.facebook.com/<uid>/picture` branch — the only correct-by-construction one, since it
  derives from the `c_user` cookie — was only reached when the DOM scrape found *nothing*. It
  almost always found something, so it rarely ran.

## Resolution

Establish identity first, then require every candidate to be anchored to it:

- Read the own uid from the `c_user` cookie up front. Validate it as `/^[0-9]+$/` — it gets
  interpolated into a CSS selector *inside the page* and into a URL.
- Accept a scraped avatar only if provably ours: inside a link resolving to our own profile
  (`a[href*="/me/"]`, `profile.php?id=<uid>`, `a[href$="/<uid>"]`, `a[href*="/<uid>/"]`), or its
  CDN url contains the uid. Otherwise return `null`.
- Fall back to `graph.facebook.com/<uid>/picture`, which cannot resolve to a friend.
- **Stop the interval** once the rendered avatar is found, or after 12 attempts. Attempts are only
  counted once `c_user` exists, so a view parked on the login screen keeps waiting instead of
  exhausting its budget.

## Gotchas worth remembering

- **Never identify "our own" anything by DOM position on a Facebook page.** Order is not stable and
  self-vs-other is not encoded in the markup. The `c_user` cookie is the only authoritative signal
  for which account a BrowserView is logged into — anchor to it, and prefer deriving a value from
  it over recognising one in the DOM.
- **`a[href$="/<uid>"]` / `a[href*="/<uid>/"]` are prefix-collision safe** — a friend id that merely
  starts with our uid (`/<uid>9999`) does not match, because the leading `/` is required and the
  trailing boundary is either end-of-string or another `/`. Plain `*="<uid>"` would false-match.
- **Avoid locale-dependent anchors.** `aria-label`-based selectors ("Your profile") break for users
  running Facebook in Vietnamese or any non-English locale. uid and `/me/` are locale-independent.
- **A forever-poller plus a last-write-wins consumer turns a rare wrong read into a frequent one.**
  With a uid-derived URL there is nothing to re-poll for — the URL is stable — so stopping on
  success is both cheaper and the actual fix for the flip-flopping.
- Wrong avatars already persisted self-heal: `isAutoAvatar` in `renderer.js` treats
  `scontent`/`fbcdn`/`graph.facebook.com` urls as overwritable, while user-picked local file paths
  are left alone.
- Worst case if Facebook's markup shifts again is the graph fallback: right account, possibly lower
  resolution — never a friend. That degradation path is the reason to keep the anchored DOM scrape
  strictly best-effort rather than loosening it when it stops matching.

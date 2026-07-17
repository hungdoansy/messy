// Unit tests for the pure helpers in .github/scripts/prepend-changelog.js.

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderEntry, insertEntry } = require("../.github/scripts/prepend-changelog.js");

test("renderEntry matches the repo's `## [x.y.z] - date` format", () => {
  assert.equal(
    renderEntry("1.4.0", "2026-07-17", "- added a thing"),
    "## [1.4.0] - 2026-07-17\n\n- added a thing\n\n",
  );
});

test("renderEntry falls back when notes are empty", () => {
  assert.equal(
    renderEntry("1.4.0", "2026-07-17", "   "),
    "## [1.4.0] - 2026-07-17\n\n- No user-facing changes.\n\n",
  );
});

test("insertEntry places the new section above the most recent one", () => {
  const current =
    "# Changelog\n\nAll notable changes.\n\n## [1.3.0] - 2026-05-05\n\n- old stuff\n";
  const entry = renderEntry("1.4.0", "2026-07-17", "- new stuff");
  const out = insertEntry(current, entry);
  // New entry appears before the old one, intro preserved.
  assert.match(out, /All notable changes\.\n\n## \[1\.4\.0\] - 2026-07-17\n\n- new stuff\n\n## \[1\.3\.0\]/);
  assert.ok(out.indexOf("[1.4.0]") < out.indexOf("[1.3.0]"));
});

test("insertEntry appends when there is no existing entry", () => {
  const current = "# Changelog\n\n";
  const entry = renderEntry("1.0.0", "2026-07-17", "- first release");
  const out = insertEntry(current, entry);
  assert.equal(out, "# Changelog\n\n## [1.0.0] - 2026-07-17\n\n- first release\n\n");
});

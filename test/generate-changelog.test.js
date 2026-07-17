// Unit tests for the pure helpers in .github/scripts/generate-changelog.js.
// Requiring the module does not run the CLI flow (guarded by require.main).

const test = require("node:test");
const assert = require("node:assert/strict");
const { mkdtempSync, readFileSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const {
  stripConventionalPrefix,
  isNoiseCommit,
  toBullets,
  polishWithGemini,
  writeOutput,
} = require("../.github/scripts/generate-changelog.js");

test("stripConventionalPrefix removes type/scope/bang prefixes", () => {
  assert.equal(stripConventionalPrefix("feat: add sidebar"), "add sidebar");
  assert.equal(stripConventionalPrefix("fix(auth): handle expiry"), "handle expiry");
  assert.equal(stripConventionalPrefix("refactor!: drop legacy path"), "drop legacy path");
  // No prefix → unchanged.
  assert.equal(stripConventionalPrefix("Bump Electron to 43"), "Bump Electron to 43");
});

test("isNoiseCommit flags release/docs commits only", () => {
  assert.equal(isNoiseCommit("release: v1.4.0"), true);
  assert.equal(isNoiseCommit("docs(readme): tidy"), true);
  assert.equal(isNoiseCommit("feat: real change"), false);
  assert.equal(isNoiseCommit("fix: real change"), false);
});

test("toBullets: happy path — one bullet per non-noise commit, prefixes stripped", () => {
  const subjects = ["feat: add multi-account", "fix(pin): unlock edge case"];
  assert.equal(toBullets(subjects), "- add multi-account\n- unlock edge case");
});

test("toBullets: excludes release:/docs: and drops empties", () => {
  const subjects = ["feat: keep me", "release: v1.0.0", "docs: tidy", "", "   "];
  assert.equal(toBullets(subjects), "- keep me");
});

test("polishWithGemini: no API key → raw list, no throw", async () => {
  const prev = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  try {
    const raw = "- a\n- b";
    const { text, note } = await polishWithGemini(raw);
    assert.equal(text, raw);
    assert.match(note, /not set/i);
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
  }
});

test("polishWithGemini: API failure → falls back to raw list, no throw", async () => {
  const prev = process.env.GEMINI_API_KEY;
  process.env.GEMINI_API_KEY = "test-key";
  const failingFetch = async () => ({ ok: false, status: 500, json: async () => ({}) });
  try {
    const raw = "- a\n- b";
    const { text, note } = await polishWithGemini(raw, failingFetch);
    assert.equal(text, raw);
    assert.match(note, /failed/i);
  } finally {
    if (prev !== undefined) process.env.GEMINI_API_KEY = prev;
    else delete process.env.GEMINI_API_KEY;
  }
});

test("writeOutput appends a heredoc-delimited multi-line value to the output file", () => {
  const dir = mkdtempSync(join(tmpdir(), "changelog-out-"));
  const file = join(dir, "out.txt");
  try {
    writeOutput("text", "- line one\n- line two", file);
    const contents = readFileSync(file, "utf8");
    assert.match(contents, /^text<<GENERATE_CHANGELOG_EOF\n- line one\n- line two\nGENERATE_CHANGELOG_EOF\n$/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

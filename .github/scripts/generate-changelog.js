// ============================================================
//  generate-changelog.js
//  Collect commit subjects since the last v* tag, strip
//  conventional-commit prefixes, and (optionally) rewrite them
//  into user-facing release notes with the Gemini API.
//
//  Ported from hungdoansy/nodl, de-nested to this flat repo and
//  written CommonJS-style to match the rest of the codebase.
//
//  Behavior:
//   - No prior v* tag  → use the last 20 commits.
//   - `release:` / `docs:` commits are dropped.
//   - GEMINI_API_KEY missing OR the API call fails → fall back to
//     the raw bullet list and still exit 0 (never fail the release).
//   - Writes the result to $GITHUB_OUTPUT under `text`, and a
//     summary to $GITHUB_STEP_SUMMARY.
//
//  The pure helpers are exported so they can be unit-tested with
//  `node --test`; requiring this module does NOT run the CLI flow.
// ============================================================

const { execFileSync } = require("node:child_process");
const { appendFileSync } = require("node:fs");

// ---- pure helpers ------------------------------------------

// Strip a leading conventional-commit prefix: `type(scope)!: `.
function stripConventionalPrefix(subject) {
  return String(subject)
    .replace(/^\s*[a-z]+(\([^)]*\))?!?:\s+/i, "")
    .trim();
}

// Commits that should never appear in user-facing notes.
function isNoiseCommit(subject) {
  return /^\s*(release|docs)(\([^)]*\))?!?:/i.test(String(subject));
}

// Turn raw commit subjects into a markdown bullet list.
function toBullets(subjects) {
  return subjects
    .map((s) => String(s).trim())
    .filter(Boolean)
    .filter((s) => !isNoiseCommit(s))
    .map(stripConventionalPrefix)
    .filter(Boolean)
    .map((s) => `- ${s}`)
    .join("\n");
}

// ---- git collection ----------------------------------------

// Run git with an argument array — no shell, so tag/ref values can't be
// interpreted as shell metacharacters.
function git(args) {
  return execFileSync("git", args, { encoding: "utf8" }).trim();
}

// Most recent v* tag by semantic order, or "" when there is none.
function latestVersionTag() {
  try {
    const out = git(["tag", "--list", "v*", "--sort=-v:refname"]);
    return out ? out.split("\n")[0].trim() : "";
  } catch {
    return "";
  }
}

// Commit subjects since the last tag (or the last 20 when none).
function getCommitSubjects(lastTag = latestVersionTag()) {
  const args = lastTag
    ? ["log", `${lastTag}..HEAD`, "--no-merges", "--pretty=tformat:%s"]
    : ["log", "-20", "--no-merges", "--pretty=tformat:%s"];
  let out = "";
  try {
    out = git(args);
  } catch {
    out = "";
  }
  return out ? out.split("\n") : [];
}

// ---- Gemini polish (with fallback) -------------------------

async function polishWithGemini(rawBullets, fetchImpl = globalThis.fetch) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return { text: rawBullets, note: "GEMINI_API_KEY not set — using the raw commit list." };
  }
  const model = process.env.GEMINI_MODEL || "gemini-2.5-flash";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const prompt =
    "Rewrite the following commit messages as concise, user-facing release notes. " +
    "Keep them as a short markdown bullet list, group related items, drop internal/noise " +
    "changes, and do not invent anything not present in the input.\n\n" +
    rawBullets;
  try {
    const res = await fetchImpl(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }] }),
    });
    if (!res.ok) throw new Error(`Gemini API responded ${res.status}`);
    const data = await res.json();
    const text = (data?.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || "")
      .join("")
      .trim();
    if (!text) throw new Error("empty Gemini response");
    return { text, note: `Changelog polished with ${model}.` };
  } catch (err) {
    return { text: rawBullets, note: `Gemini polish failed (${err.message}) — using the raw commit list.` };
  }
}

// ---- GitHub Actions output ---------------------------------

// Append a (possibly multi-line) value to $GITHUB_OUTPUT.
function writeOutput(name, value, file = process.env.GITHUB_OUTPUT) {
  if (!file) return;
  const delim = "GENERATE_CHANGELOG_EOF";
  appendFileSync(file, `${name}<<${delim}\n${value}\n${delim}\n`);
}

function writeSummary(markdown, file = process.env.GITHUB_STEP_SUMMARY) {
  if (file) appendFileSync(file, `${markdown}\n`);
}

// ---- CLI entry ---------------------------------------------

async function main() {
  const subjects = getCommitSubjects();
  const rawBullets = toBullets(subjects) || "- No user-facing changes.";
  const { text, note } = await polishWithGemini(rawBullets);
  writeOutput("text", text);
  writeSummary(`### Changelog\n\n_${note}_\n\n${text}`);
  console.log(text);
}

module.exports = {
  stripConventionalPrefix,
  isNoiseCommit,
  toBullets,
  latestVersionTag,
  getCommitSubjects,
  polishWithGemini,
  writeOutput,
};

if (require.main === module) {
  main().catch((err) => {
    // Never fail the release for changelog problems.
    console.error(`changelog generation error: ${err.message}`);
  });
}

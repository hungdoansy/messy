// ============================================================
//  prepend-changelog.js
//  Insert a new release section at the top of CHANGELOG.md,
//  above the most recent existing entry, matching the repo's
//  `## [x.y.z] - YYYY-MM-DD` format.
//
//  Env: VERSION (required, x.y.z), NOTES (markdown bullets),
//       DATE (optional, defaults to today), FILE (optional).
//
//  The pure helpers are exported for `node --test`; requiring
//  this module does NOT touch the filesystem.
// ============================================================

const { readFileSync, writeFileSync, existsSync } = require("node:fs");

// Render a single changelog section.
function renderEntry(version, date, notes) {
  const body = notes && notes.trim() ? notes.trim() : "- No user-facing changes.";
  return `## [${version}] - ${date}\n\n${body}\n\n`;
}

// Insert `entry` above the first existing `## ` release heading,
// or append it if there is none yet.
function insertEntry(current, entry) {
  const marker = current.search(/^## /m);
  if (marker === -1) {
    return `${current.replace(/\s*$/, "")}\n\n${entry}`;
  }
  const head = current.slice(0, marker).replace(/\s*$/, "");
  const rest = current.slice(marker);
  return `${head}\n\n${entry}${rest}`;
}

function main() {
  const version = process.env.VERSION;
  if (!version) throw new Error("VERSION env var is required");
  const date = process.env.DATE || new Date().toISOString().slice(0, 10);
  const notes = process.env.NOTES || "";
  const file = process.env.FILE || "CHANGELOG.md";

  const current = existsSync(file) ? readFileSync(file, "utf8") : "# Changelog\n\n";
  const updated = insertEntry(current, renderEntry(version, date, notes));
  writeFileSync(file, updated);
}

module.exports = { renderEntry, insertEntry };

if (require.main === module) {
  main();
}

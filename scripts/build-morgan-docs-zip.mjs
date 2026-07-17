#!/usr/bin/env node
/**
 * Zip up all of Morgan's source documents so a clinician can download them
 * in one click from the portal / viewer.
 *
 * Output: /tmp/morgan-all-documents.zip
 *
 * Then upload as a release asset:
 *   gh release upload morgan-large-docs /tmp/morgan-all-documents.zip --clobber
 *
 * Usage:
 *   node scripts/build-morgan-docs-zip.mjs
 */

import { execSync } from "node:child_process";
import { existsSync, readdirSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DOCS_DIR =
  process.env.MORGAN_DOCS_DIR ||
  path.join(
    homedir(),
    "Documents/GitHub/Morgan-SHl/public/shl/morgan/docs",
  );
const OUT = process.env.MORGAN_ZIP_OUT || "/tmp/morgan-all-documents.zip";

if (!existsSync(DOCS_DIR)) {
  console.error(`Docs dir not found: ${DOCS_DIR}`);
  process.exit(1);
}

const files = readdirSync(DOCS_DIR).filter((f) => !f.startsWith("."));
const totalBytes = files.reduce(
  (n, f) => n + statSync(path.join(DOCS_DIR, f)).size,
  0,
);

console.log(`Zipping ${files.length} files (${(totalBytes / 1024 / 1024).toFixed(1)} MB) → ${OUT}`);

// Use system `zip` (installed on every macOS). -j strips the path, -X strips
// mac metadata, -q quiet, -1 fastest compression.
try {
  execSync(`rm -f "${OUT}"`);
  execSync(
    `cd "${DOCS_DIR}" && zip -q -1 -X "${OUT}" *.pdf`,
    { stdio: "inherit" },
  );
} catch (e) {
  console.error("zip failed:", e.message);
  process.exit(1);
}

const outSize = statSync(OUT).size;
console.log(`\n✓ Wrote ${OUT}`);
console.log(`  ${(outSize / 1024 / 1024).toFixed(1)} MB`);
console.log(`\nUpload to GitHub Release:`);
console.log(`  cd ~/Documents/GitHub/Morgan-SHl`);
console.log(`  gh release upload morgan-large-docs ${OUT} --clobber`);
console.log(`\nThe portal + viewer already point at:`);
console.log(`  https://github.com/amy-gleason/Morgan-SHl/releases/download/morgan-large-docs/morgan-all-documents.zip`);

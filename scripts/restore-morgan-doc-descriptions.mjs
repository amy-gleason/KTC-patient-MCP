#!/usr/bin/env node
/**
 * Restore the pre-edit DocumentReference.description values on the 7 DocRefs
 * that update-morgan-doc-summaries.mjs modified. Reads the original values
 * from a prior file.jwe in the Morgan-SHl git history and grafts them onto
 * the currently-deployed bundle.
 *
 * Default source: `git show HEAD~3:public/shl/morgan/file.jwe` — three
 * commits back covers (1) the Cowork timeline swap, (2) the revert, and
 * (3) the original summary edit, landing on the JWE state just before I
 * ever touched descriptions.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/restore-morgan-doc-descriptions.mjs                  # dry-run, HEAD~3
 *   node scripts/restore-morgan-doc-descriptions.mjs --apply          # write JWE
 *   node scripts/restore-morgan-doc-descriptions.mjs 4af4931 --apply  # explicit source commit
 *   PRIOR_JWE=/tmp/old.jwe node scripts/restore-morgan-doc-descriptions.mjs --apply
 *
 * If the automatic HEAD~3 lookup grabs the wrong revision, pass either a
 * commit SHA (must be a ref reachable from HEAD in the Morgan-SHl repo) or
 * set PRIOR_JWE to a decrypted-source JWE file path.
 */

import { decryptJwe, encryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { writeFileSync } from "node:fs";
import { execSync } from "node:child_process";
import { homedir } from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const sourceRef =
  process.argv.find((a) => !a.startsWith("--") && a !== process.argv[0] && a !== process.argv[1]) ||
  "HEAD~3";

const JWE_URL =
  process.env.MORGAN_JWE_URL ||
  "https://morgans-shl.vercel.app/shl/morgan/file.jwe";
const KEY = base64UrlDecode(
  process.env.MORGAN_KEY || "qcL0Ww-PF9VPysTlK-NnHyQeWgBVVIPuiC06zxb4hxc",
);
const JWE_PATH =
  process.env.MORGAN_JWE_PATH ||
  path.join(
    homedir(),
    "Documents/GitHub/Morgan-SHl/public/shl/morgan/file.jwe",
  );
const PRIOR_JWE = process.env.PRIOR_JWE || "";

const TARGET_FILENAMES = new Set([
  "tennessee-oncology-visit-2026-04-24.pdf",
  "tennessee-oncology-labs-2026-04-24-a.pdf",
  "tennessee-oncology-labs-2026-04-24-b.pdf",
  "tennessee-oncology-ccd-2026-04-24.pdf",
  "my-health-past-visit-details-2.pdf",
  "my-health-past-visit-details-3.pdf",
  "my-health-past-visit-details-4.pdf",
]);

// ---------- Load the OLD (pre-edit) bundle
let oldJweText;
if (PRIOR_JWE) {
  console.log(`Loading prior JWE from ${PRIOR_JWE}`);
  const { readFileSync } = await import("node:fs");
  oldJweText = readFileSync(PRIOR_JWE, "utf8");
} else {
  const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(JWE_PATH))));
  const cmd = `git -C "${repoRoot}" show ${sourceRef}:public/shl/morgan/file.jwe`;
  console.log(`Loading prior JWE via: ${cmd}`);
  try {
    oldJweText = execSync(cmd, { encoding: "utf8", maxBuffer: 128 * 1024 * 1024 });
  } catch (e) {
    console.error(`Failed to read git object: ${e.message}`);
    console.error(`Try passing an explicit commit SHA:`);
    console.error(`  git -C ${repoRoot} log --oneline public/shl/morgan/file.jwe`);
    console.error(`  node scripts/restore-morgan-doc-descriptions.mjs <sha> --apply`);
    process.exit(1);
  }
}
const oldBundle = JSON.parse(decryptJwe(oldJweText.trim(), KEY).toString("utf8"));
console.log(`  → old bundle: ${oldBundle.entry.length} entries`);

// Extract old descriptions per filename
const oldDescByFilename = new Map();
for (const e of oldBundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  const filename = dr.content?.[0]?.attachment?.url?.split("/").pop();
  if (!filename || !TARGET_FILENAMES.has(filename)) continue;
  if (dr.description) oldDescByFilename.set(filename, dr.description);
}
console.log(
  `  → found original descriptions for ${oldDescByFilename.size}/${TARGET_FILENAMES.size} target files`,
);
if (oldDescByFilename.size === 0) {
  console.error(
    `\nNo original descriptions found in ${sourceRef}. That commit may already have been past the edit. Try HEAD~4 or list history:`,
  );
  const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(JWE_PATH))));
  console.error(`  git -C ${repoRoot} log --oneline public/shl/morgan/file.jwe`);
  process.exit(1);
}

for (const [f, d] of oldDescByFilename) {
  const preview = d.length > 80 ? d.slice(0, 77) + "..." : d;
  console.log(`    ${f}: ${JSON.stringify(preview)}`);
}

// ---------- Load the CURRENT (live) bundle
console.log(`\nFetching current bundle from ${JWE_URL}...`);
const res = await fetch(JWE_URL, { cache: "no-store" });
if (!res.ok) {
  console.error(`Failed to fetch bundle: HTTP ${res.status}`);
  process.exit(1);
}
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`  → current bundle: ${bundle.entry.length} entries`);

// ---------- Graft
let updated = 0;
for (const e of bundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  const filename = dr.content?.[0]?.attachment?.url?.split("/").pop();
  if (!filename || !oldDescByFilename.has(filename)) continue;
  dr.description = oldDescByFilename.get(filename);
  updated++;
  console.log(`  ✓ restored ${filename}`);
}

console.log(`\n${updated}/${oldDescByFilename.size} descriptions grafted.`);

if (!APPLY) {
  console.log(`\nDry-run. Re-run with --apply to write ${JWE_PATH}.`);
  process.exit(0);
}

bundle.timestamp = new Date().toISOString();
const newJwe = encryptJwe(
  Buffer.from(JSON.stringify(bundle), "utf8"),
  KEY,
  { cty: "application/fhir+json" },
);
writeFileSync(JWE_PATH, newJwe);
console.log(`\n✓ Wrote ${JWE_PATH}`);
const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(JWE_PATH))));
console.log(`\nDeploy:`);
console.log(`  cd ${repoRoot}`);
console.log(`  git add public/shl/morgan/file.jwe`);
console.log(`  git commit -m "restore: original DocumentReference descriptions on the 7 recent DocRefs"`);
console.log(`  git push`);
console.log(`\nThen regenerate the portal:`);
console.log(`  cd ~/KTC-patient-MCP`);
console.log(`  node scripts/generate-morgan-portal.mjs --apply`);

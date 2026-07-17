#!/usr/bin/env node
/**
 * Undo the DocumentReference.description edits made by
 * update-morgan-doc-summaries.mjs. The multi-sentence summaries belong in
 * the timeline PDF, not in the portal's Document column, so this script
 * clears `description` on the 7 affected DocRefs. `attachment.title`
 * (short human-readable label like "Tennessee Oncology — Dr. Michael Byrne,
 * Initial CAR-T Consultation") is preserved.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/revert-morgan-doc-descriptions.mjs            # dry-run
 *   node scripts/revert-morgan-doc-descriptions.mjs --apply    # write JWE
 */

import { decryptJwe, encryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { writeFileSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");

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

const TARGET_FILENAMES = new Set([
  "tennessee-oncology-visit-2026-04-24.pdf",
  "tennessee-oncology-labs-2026-04-24-a.pdf",
  "tennessee-oncology-labs-2026-04-24-b.pdf",
  "tennessee-oncology-ccd-2026-04-24.pdf",
  "my-health-past-visit-details-2.pdf",
  "my-health-past-visit-details-3.pdf",
  "my-health-past-visit-details-4.pdf",
]);

console.log(`Fetching bundle from ${JWE_URL}...`);
const res = await fetch(JWE_URL, { cache: "no-store" });
if (!res.ok) {
  console.error(`Failed to fetch bundle: HTTP ${res.status}`);
  process.exit(1);
}
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle: ${bundle.entry.length} entries`);

let cleared = 0;
for (const e of bundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  const filename = dr.content?.[0]?.attachment?.url?.split("/").pop();
  if (!filename || !TARGET_FILENAMES.has(filename)) continue;
  if (dr.description) {
    delete dr.description;
    cleared++;
    console.log(`  ✓ cleared description on ${filename}`);
  }
}

console.log(`\n${cleared}/${TARGET_FILENAMES.size} descriptions cleared.`);

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
console.log(`  git commit -m "revert: clear description on 7 recent DocRefs (moved to timeline PDF)"`);
console.log(`  git push`);

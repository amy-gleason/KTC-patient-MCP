#!/usr/bin/env node
/**
 * Post-hoc cleanup: after rebuild-morgan-priority-pdfs.mjs and any manual
 * upload of historical PDFs, this script HEAD-checks every DocumentReference
 * URL in Morgan's bundle and deletes any DocRef whose URL 404s.
 *
 * The updated bundle is re-encrypted with the SAME per-link key so the
 * existing shlink URI keeps working — no viewer-side re-add needed.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/clean-morgan-broken-refs.mjs             # dry-run
 *   node scripts/clean-morgan-broken-refs.mjs --apply     # writes new file.jwe
 */

import { decryptJwe, encryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { writeFileSync, existsSync } from "node:fs";
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

if (APPLY && !existsSync(path.dirname(JWE_PATH))) {
  console.error(`Cannot write: ${JWE_PATH} parent does not exist.`);
  process.exit(1);
}

const res = await fetch(JWE_URL, { cache: "no-store" });
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle: ${bundle.entry.length} entries.`);

const urls = [];
for (const [i, e] of (bundle.entry ?? []).entries()) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  for (const c of dr.content ?? []) {
    if (c.attachment?.url) urls.push({ i, url: c.attachment.url });
  }
}
console.log(`Checking ${urls.length} URLs...`);

const brokenIdx = new Set();
for (let i = 0; i < urls.length; i += 10) {
  const batch = urls.slice(i, i + 10);
  const rs = await Promise.all(
    batch.map(async (u) => {
      try {
        const r = await fetch(u.url, { method: "HEAD" });
        return { ...u, status: r.status };
      } catch {
        return { ...u, status: "ERR" };
      }
    }),
  );
  for (const r of rs) {
    if (r.status !== 200) {
      brokenIdx.add(r.i);
      console.log(`  [${r.status}] ${r.url.split("/").pop()}`);
    }
  }
  process.stderr.write(".");
}
console.log("");

if (brokenIdx.size === 0) {
  console.log("✓ Every URL returns 200. Nothing to clean.");
  process.exit(0);
}

console.log(`\nBroken DocumentReferences: ${brokenIdx.size}`);

const dropRefs = new Set();
const kept = bundle.entry.filter((e, i) => {
  if (brokenIdx.has(i)) {
    if (e.fullUrl) dropRefs.add(e.fullUrl);
    return false;
  }
  return true;
});
const comp = kept.find((e) => e.resource?.resourceType === "Composition")?.resource;
if (comp?.section) {
  for (const s of comp.section) {
    if (Array.isArray(s.entry)) {
      s.entry = s.entry.filter((r) => !dropRefs.has(r.reference));
    }
  }
}
bundle.entry = kept;
bundle.timestamp = new Date().toISOString();

console.log(`After cleanup: ${bundle.entry.length} entries.`);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to write the patched JWE.");
  process.exit(0);
}

const newJwe = encryptJwe(
  Buffer.from(JSON.stringify(bundle), "utf8"),
  KEY,
  { cty: "application/fhir+json" },
);
writeFileSync(JWE_PATH, newJwe);
console.log(`\n✓ Wrote patched JWE to ${JWE_PATH}`);
console.log(`Commit + deploy:`);
const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(JWE_PATH))));
console.log(`  cd ${repoRoot}`);
console.log(`  git add public/shl/morgan/file.jwe`);
console.log(`  git commit -m "clean: remove DocumentReferences with unreachable URLs"`);
console.log(`  git push`);

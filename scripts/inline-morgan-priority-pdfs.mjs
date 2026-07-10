#!/usr/bin/env node
/**
 * CommonHealth's viewer (viewer.commonhealth.org) requires DocumentReference
 * attachments to have inline `data` (base64-encoded), not `url`. It never
 * fetches URL references — so URL-only DocRefs fail with atob(undefined).
 *
 * This script inlines the 4 priority-tier PDFs in Morgan's bundle as
 * standard base64 (not base64url — atob() rejects base64url). Archive-tier
 * URL refs are left alone; those still work in SHL-native scanners.
 *
 * Optionally, --drop-archive removes all URL-only DocRefs entirely so that
 * CommonHealth users don't see broken entries. Recommended for a clean UX.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/inline-morgan-priority-pdfs.mjs              # inline 4 priorities, keep archive URLs
 *   node scripts/inline-morgan-priority-pdfs.mjs --drop-archive  # inline priorities, drop URL-only refs
 */

import { decryptJwe, encryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import path from "node:path";

const DROP_ARCHIVE = process.argv.includes("--drop-archive");

const JWE_URL =
  process.env.MORGAN_JWE_URL ||
  "https://morgans-shl.vercel.app/shl/morgan/file.jwe";
const KEY = base64UrlDecode(
  process.env.MORGAN_KEY || "qcL0Ww-PF9VPysTlK-NnHyQeWgBVVIPuiC06zxb4hxc",
);
const DOCS_DIR =
  process.env.MORGAN_DOCS_DIR ||
  path.join(
    homedir(),
    "Documents/GitHub/Morgan-SHl/public/shl/morgan/docs",
  );
const JWE_PATH =
  process.env.MORGAN_JWE_PATH ||
  path.join(
    homedir(),
    "Documents/GitHub/Morgan-SHl/public/shl/morgan/file.jwe",
  );

// The 4 priority-tier filenames (must exist in DOCS_DIR).
const PRIORITY_FILENAMES = [
  "morgan-gleason-ips-patient-summary.pdf",
  "morgan-gleason-clinical-summary-and-timeline.pdf",
  "health-summary.pdf",
  "measurements.pdf",
];

// Verify all priority PDFs exist locally
for (const f of PRIORITY_FILENAMES) {
  const p = path.join(DOCS_DIR, f);
  if (!existsSync(p)) {
    console.error(`Missing priority PDF: ${p}`);
    console.error(`Run scripts/rebuild-morgan-priority-pdfs.mjs first.`);
    process.exit(1);
  }
}

console.log(`Fetching bundle...`);
const res = await fetch(JWE_URL, { cache: "no-store" });
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle: ${bundle.entry.length} entries`);

// Build a filename -> DocRef index
const drByFilename = new Map();
for (const e of bundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  for (const c of dr.content ?? []) {
    const a = c.attachment;
    if (!a?.url) continue;
    const filename = a.url.split("/").pop();
    if (!drByFilename.has(filename)) drByFilename.set(filename, []);
    drByFilename.get(filename).push({ entry: e, attachment: a });
  }
}

// Inline priority PDFs
let inlined = 0;
for (const filename of PRIORITY_FILENAMES) {
  const targets = drByFilename.get(filename) || [];
  if (!targets.length) {
    console.warn(`  ! No DocRef references ${filename}, skipping`);
    continue;
  }
  const pdfBytes = readFileSync(path.join(DOCS_DIR, filename));
  const dataB64 = pdfBytes.toString("base64"); // standard base64, atob-compatible
  const hashB64 = createHash("sha1").update(pdfBytes).digest("base64");
  for (const t of targets) {
    delete t.attachment.url;
    t.attachment.data = dataB64;
    t.attachment.size = pdfBytes.length;
    t.attachment.hash = hashB64;
    t.attachment.contentType = "application/pdf";
    inlined++;
  }
  console.log(`  ✓ inlined ${filename} (${(pdfBytes.length / 1024).toFixed(1)} KB) into ${targets.length} DocRef(s)`);
}

// Optionally drop archive URL-only DocRefs so CommonHealth users don't see broken entries
let dropped = 0;
if (DROP_ARCHIVE) {
  const dropRefs = new Set();
  bundle.entry = bundle.entry.filter((e) => {
    const dr = e.resource;
    if (dr?.resourceType !== "DocumentReference") return true;
    // Keep DocRefs that now have inline data
    const hasData = (dr.content ?? []).some((c) => c.attachment?.data);
    if (hasData) return true;
    // Drop URL-only
    if (e.fullUrl) dropRefs.add(e.fullUrl);
    dropped++;
    return false;
  });
  const comp = bundle.entry.find(
    (e) => e.resource?.resourceType === "Composition",
  )?.resource;
  if (comp?.section) {
    for (const s of comp.section) {
      if (Array.isArray(s.entry))
        s.entry = s.entry.filter((r) => !dropRefs.has(r.reference));
    }
  }
  console.log(`  ✓ dropped ${dropped} URL-only DocRefs`);
}

bundle.timestamp = new Date().toISOString();

console.log(`\nFinal bundle: ${bundle.entry.length} entries.`);
const bundleJson = JSON.stringify(bundle);
console.log(`Bundle JSON size: ${(bundleJson.length / 1024 / 1024).toFixed(2)} MB`);

const newJwe = encryptJwe(Buffer.from(bundleJson, "utf8"), KEY, {
  cty: "application/fhir+json",
});
console.log(`Encrypted JWE size: ${(newJwe.length / 1024 / 1024).toFixed(2)} MB`);

writeFileSync(JWE_PATH, newJwe);
console.log(`\n✓ Wrote to ${JWE_PATH}`);
const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(JWE_PATH))));
console.log(`\nCommit + deploy:`);
console.log(`  cd ${repoRoot}`);
console.log(`  git add public/shl/morgan/file.jwe`);
console.log(`  git commit -m "inline priority PDFs so CommonHealth viewer can render them"`);
console.log(`  git push`);

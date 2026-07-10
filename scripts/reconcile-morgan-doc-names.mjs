#!/usr/bin/env node
/**
 * Reconcile Morgan bundle's DocumentReference URLs against files actually
 * hosted in the Morgan-SHl repo's docs folder.
 *
 * Many DocRefs 404 not because the file is missing, but because the bundle
 * references a slightly different slug than the hosted filename (e.g.
 * "dr-gorum-neuro.pdf" vs "dr-gorum-neuro-records.pdf").
 *
 * Strategy: for each broken URL, find the closest-named PDF in /docs/.
 * By default cp the existing file to the expected name (fast, keeps the
 * bundle unchanged). With --update-bundle, rewrites the bundle's URL and
 * re-encrypts the JWE instead.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/reconcile-morgan-doc-names.mjs                 # dry-run: shows matches
 *   node scripts/reconcile-morgan-doc-names.mjs --apply         # cp files to expected names
 *   node scripts/reconcile-morgan-doc-names.mjs --apply --update-bundle
 *                                                                # rewrites bundle URLs instead
 */

import { decryptJwe, encryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import {
  readdirSync,
  existsSync,
  writeFileSync,
  copyFileSync,
} from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const APPLY = process.argv.includes("--apply");
const UPDATE_BUNDLE = process.argv.includes("--update-bundle");

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

if (!existsSync(DOCS_DIR)) {
  console.error(`Docs dir does not exist: ${DOCS_DIR}`);
  process.exit(1);
}

const local = readdirSync(DOCS_DIR).filter((f) => f.endsWith(".pdf"));
console.log(`Local /docs/: ${local.length} PDFs`);

const res = await fetch(JWE_URL, { cache: "no-store" });
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle: ${bundle.entry.length} entries`);

// Extract every DocRef URL + expected filename
const refs = [];
for (const e of bundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  for (const c of dr.content ?? []) {
    if (c.attachment?.url) {
      refs.push({
        entry: e,
        attachment: c.attachment,
        filename: c.attachment.url.split("/").pop(),
      });
    }
  }
}

// HEAD each URL
console.log(`Checking ${refs.length} URLs...`);
const broken = [];
for (let i = 0; i < refs.length; i += 10) {
  const batch = refs.slice(i, i + 10);
  const rs = await Promise.all(
    batch.map(async (r) => {
      try {
        const resp = await fetch(r.attachment.url, { method: "HEAD" });
        return { ...r, status: resp.status };
      } catch {
        return { ...r, status: "ERR" };
      }
    }),
  );
  for (const r of rs) if (r.status !== 200) broken.push(r);
  process.stderr.write(".");
}
console.log("");

if (!broken.length) {
  console.log("✓ Every URL returns 200. Nothing to reconcile.");
  process.exit(0);
}

console.log(`\nBroken URLs: ${broken.length}\n`);

// -- fuzzy match: compare tokens
function tokens(name) {
  return name
    .toLowerCase()
    .replace(/\.pdf$/i, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}
function score(expected, candidate) {
  const a = new Set(tokens(expected));
  const b = new Set(tokens(candidate));
  let common = 0;
  for (const t of a) if (b.has(t)) common++;
  return common / Math.max(a.size, b.size);
}

const decisions = [];
for (const r of broken) {
  let best = null;
  let bestScore = 0;
  for (const cand of local) {
    const s = score(r.filename, cand);
    if (s > bestScore) {
      bestScore = s;
      best = cand;
    }
  }
  decisions.push({ ...r, match: best, score: bestScore });
}

console.log("=== Match plan ===");
for (const d of decisions) {
  const ok = d.match && d.score >= 0.4;
  const marker = ok ? "→" : "✗";
  console.log(
    `  ${marker} ${d.filename.padEnd(48)} ${ok ? d.match : "(no confident match, score " + d.score.toFixed(2) + ")"}`,
  );
}

const matched = decisions.filter((d) => d.match && d.score >= 0.4);
const unmatched = decisions.filter((d) => !d.match || d.score < 0.4);

console.log(`\n${matched.length} matched, ${unmatched.length} unmatched.`);

if (!APPLY) {
  console.log("\nDry-run only. Re-run with --apply to fix.");
  console.log("Modes:");
  console.log("  --apply                    : cp existing → expected filename (bundle unchanged)");
  console.log("  --apply --update-bundle    : rewrite bundle URLs to point at existing files");
  process.exit(0);
}

if (UPDATE_BUNDLE) {
  // Rewrite bundle URL to point at the existing file's URL
  for (const d of matched) {
    const parts = d.attachment.url.split("/");
    parts[parts.length - 1] = d.match;
    d.attachment.url = parts.join("/");
  }
  bundle.timestamp = new Date().toISOString();
  const newJwe = encryptJwe(
    Buffer.from(JSON.stringify(bundle), "utf8"),
    KEY,
    { cty: "application/fhir+json" },
  );
  writeFileSync(JWE_PATH, newJwe);
  console.log(`\n✓ Rewrote ${matched.length} URLs in the bundle.`);
  console.log(`  Patched JWE written to: ${JWE_PATH}`);
  const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(JWE_PATH))));
  console.log(`\nCommit + deploy:`);
  console.log(`  cd ${repoRoot}`);
  console.log(`  git add public/shl/morgan/file.jwe`);
  console.log(`  git commit -m "reconcile: point DocRefs at actual hosted filenames"`);
  console.log(`  git push`);
} else {
  // cp existing → expected filename
  for (const d of matched) {
    const src = path.join(DOCS_DIR, d.match);
    const dst = path.join(DOCS_DIR, d.filename);
    copyFileSync(src, dst);
    console.log(`  cp ${d.match} → ${d.filename}`);
  }
  console.log(`\n✓ Copied ${matched.length} files.`);
  console.log(`\nCommit + deploy:`);
  console.log(`  cd ${path.dirname(path.dirname(path.dirname(DOCS_DIR)))}`);
  console.log(`  git add public/shl/morgan/docs/`);
  console.log(`  git commit -m "reconcile: alias existing PDFs to expected filenames"`);
  console.log(`  git push`);
}

if (unmatched.length) {
  console.log(`\n${unmatched.length} still unmatched — genuinely missing:`);
  for (const d of unmatched) console.log(`  ${d.filename}`);
  console.log(
    `\nFor these, either upload the source PDF or run scripts/clean-morgan-broken-refs.mjs --apply to drop them from the bundle.`,
  );
}

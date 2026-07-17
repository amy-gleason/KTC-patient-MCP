#!/usr/bin/env node
/**
 * Extract plain text from a PDF in Morgan's docs folder and write it to a
 * `.txt` file alongside it. Useful when a PDF is too big to attach to chat
 * directly — the text-only extraction is usually <1% of the original size.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/extract-morgan-doc-text.mjs articularis-group-dr-adams-2022-2025.pdf
 *   node scripts/extract-morgan-doc-text.mjs eamc-2016-2021.pdf
 *
 *   # multiple at once:
 *   node scripts/extract-morgan-doc-text.mjs articularis-group-dr-adams-2022-2025.pdf eamc-2016-2021.pdf
 *
 * Writes: <same-dir>/<basename>.txt
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const DOCS_DIR =
  process.env.MORGAN_DOCS_DIR ||
  path.join(
    homedir(),
    "Documents/GitHub/Morgan-SHl/public/shl/morgan/docs",
  );

const args = process.argv.slice(2);
if (!args.length) {
  console.error("Usage: node scripts/extract-morgan-doc-text.mjs <filename.pdf> [more.pdf ...]");
  process.exit(1);
}

// pdf-parse ships an example loader at the top of the module that breaks when
// imported normally — bypass it by importing the internal lib entrypoint.
const { default: pdfParse } = await import("pdf-parse/lib/pdf-parse.js");

for (const arg of args) {
  const inPath = path.isAbsolute(arg) ? arg : path.join(DOCS_DIR, arg);
  if (!existsSync(inPath)) {
    console.error(`  ✗ not found: ${inPath}`);
    continue;
  }
  const buf = readFileSync(inPath);
  const inKB = (buf.length / 1024).toFixed(0);
  process.stdout.write(`  ${path.basename(inPath)} (${inKB} KB) ... `);
  try {
    const parsed = await pdfParse(buf);
    const outPath = inPath.replace(/\.pdf$/i, ".txt");
    writeFileSync(outPath, parsed.text);
    const outKB = (parsed.text.length / 1024).toFixed(0);
    console.log(`✓ ${parsed.numpages} pages → ${path.basename(outPath)} (${outKB} KB)`);
  } catch (e) {
    console.log(`✗ ${e.message}`);
  }
}

console.log(`\nAttach the resulting .txt file(s) to chat.`);

#!/usr/bin/env node
/**
 * Regenerate the priority-tier summary PDFs referenced by Morgan's SHL bundle.
 *
 * Uses the deployed KTC MCP server to produce:
 *   - morgan-gleason-ips-patient-summary.pdf
 *   - morgan-gleason-clinical-summary-and-timeline.pdf
 *   - health-summary.pdf
 *   - measurements.pdf
 *
 * These are the 4 synthesized documents whose URLs 404 in the current bundle.
 * Historical PDFs (real clinical visits) are NOT touched — they must be
 * uploaded from source or the DocRef removed separately.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP
 *   npm run build
 *   node scripts/rebuild-morgan-priority-pdfs.mjs
 *   # then commit + push in the Morgan-SHl repo
 *
 * Env vars (all optional):
 *   MCP_URL         default https://ktc-patient-mcp-amy.fly.dev/mcp
 *   MORGAN_JWE_URL  default https://morgans-shl.vercel.app/shl/morgan/file.jwe
 *   MORGAN_KEY      default the well-known Morgan SHL key
 *   MORGAN_DOCS_DIR default ~/Documents/GitHub/Morgan-SHl/public/shl/morgan/docs
 */

import { decryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const MCP_URL = process.env.MCP_URL || "https://ktc-patient-mcp-amy.fly.dev/mcp";
const JWE_URL =
  process.env.MORGAN_JWE_URL ||
  "https://morgans-shl.vercel.app/shl/morgan/file.jwe";
const KEY = base64UrlDecode(
  process.env.MORGAN_KEY || "qcL0Ww-PF9VPysTlK-NnHyQeWgBVVIPuiC06zxb4hxc",
);
const DOCS_DIR =
  process.env.MORGAN_DOCS_DIR ||
  path.join(homedir(), "Documents/GitHub/Morgan-SHl/public/shl/morgan/docs");

if (!existsSync(DOCS_DIR)) {
  console.error(`Docs directory does not exist: ${DOCS_DIR}`);
  console.error("Set MORGAN_DOCS_DIR env var to override.");
  process.exit(1);
}

// -------------------------------------------------------------- fetch bundle
console.log(`Fetching Morgan bundle from ${JWE_URL}`);
const res = await fetch(JWE_URL, { cache: "no-store" });
if (!res.ok) {
  console.error(`Failed to fetch JWE: HTTP ${res.status}`);
  process.exit(1);
}
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle has ${bundle.entry?.length ?? 0} entries.`);

// ---------------------------------------------------- extract structured data
const patient = bundle.entry.find(
  (e) => e.resource?.resourceType === "Patient",
)?.resource;
const nm = patient?.name?.[0];
const patientName = nm
  ? `${nm.given?.[0] ?? ""} ${nm.family ?? ""}`.trim()
  : "Morgan Gleason";
const patientDob = patient?.birthDate;

const conditions = [
  ...new Set(
    bundle.entry
      .filter((e) => e.resource?.resourceType === "Condition")
      .map(
        (e) =>
          e.resource.code?.text ||
          e.resource.code?.coding?.[0]?.display ||
          "Unknown",
      ),
  ),
];

const medications = bundle.entry
  .filter((e) => e.resource?.resourceType === "MedicationStatement")
  .map((e) => {
    const cc = e.resource.medicationCodeableConcept;
    const text = cc?.text || cc?.coding?.[0]?.display || "Unknown";
    const m = text.match(/^(.*?)\s*[—–-]\s*(.+)$/);
    return m ? { medication: m[1].trim(), dose: m[2].trim() } : { medication: text };
  });

const timeline = [];
for (const e of bundle.entry ?? []) {
  const r = e.resource;
  if (!r) continue;
  let date, event;
  if (r.resourceType === "Procedure" && r.performedDateTime) {
    date = r.performedDateTime.slice(0, 10);
    event = r.code?.text || r.code?.coding?.[0]?.display || "Procedure";
  } else if (r.resourceType === "Observation" && r.effectiveDateTime) {
    date = r.effectiveDateTime.slice(0, 10);
    event = r.code?.text || "Observation";
  } else if (r.resourceType === "Condition" && r.onsetDateTime) {
    date = r.onsetDateTime.slice(0, 10);
    event = `Diagnosis: ${r.code?.text || "Condition"}`;
  } else if (r.resourceType === "Immunization" && r.occurrenceDateTime) {
    date = r.occurrenceDateTime.slice(0, 10);
    event = r.vaccineCode?.text || "Immunization";
  }
  if (date && event) timeline.push({ date, event });
}
timeline.sort((a, b) => b.date.localeCompare(a.date));

console.log(
  `Extracted: ${conditions.length} conditions, ${medications.length} meds, ${timeline.length} timeline events.`,
);

// --------------------------------------------------- call KTC MCP over HTTP
async function callTool(name, args) {
  const req = {
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name, arguments: args },
  };
  const r = await fetch(MCP_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: JSON.stringify(req),
  });
  const text = await r.text();
  // Streamable HTTP transport returns SSE: "event: message\ndata: {...}\n\n"
  const dataLine = text.split("\n").find((l) => l.startsWith("data: "));
  if (!dataLine) throw new Error(`No SSE data line: ${text.slice(0, 200)}`);
  const parsed = JSON.parse(dataLine.slice(6));
  if (parsed.error) throw new Error(`RPC error: ${JSON.stringify(parsed.error)}`);
  const result = parsed.result;
  if (result.isError)
    throw new Error(`Tool ${name} error: ${result.content?.[0]?.text}`);
  // Render tools return content[0].text as JSON with { base64, filename, sizeBytes }
  return JSON.parse(result.content[0].text);
}

async function renderAndSave(toolName, args, filename) {
  process.stdout.write(`  ${toolName} → ${filename} ... `);
  const out = await callTool(toolName, args);
  const outPath = path.join(DOCS_DIR, filename);
  writeFileSync(outPath, Buffer.from(out.base64, "base64"));
  console.log(`✓ ${out.sizeBytes} bytes`);
}

// -------------------------------------------------- render all 4 priority PDFs
console.log(`\nRendering priority PDFs via ${MCP_URL} ...`);

// 1 + 2 — IPS narrative used for both filenames (same content, satisfies both refs)
await renderAndSave(
  "render_ips_narrative_pdf",
  { bundle },
  "morgan-gleason-ips-patient-summary.pdf",
);
await renderAndSave(
  "render_ips_narrative_pdf",
  { bundle },
  "health-summary.pdf",
);

// 3 — clinical summary + timeline (combined by name)
const oneLiner = `${patientName}${patientDob ? `, DOB ${patientDob}` : ""}: patient-authored health summary. ${conditions.length} active conditions, ${medications.length} medications.`;
await renderAndSave(
  "render_clinical_summary_pdf",
  {
    patientName,
    patientDob,
    oneLiner,
    history: conditions.length
      ? [`Active conditions include: ${conditions.slice(0, 10).join("; ")}.`]
      : [],
    currentRegimen: medications.slice(0, 30),
    activeIssues: conditions.slice(0, 15),
    assessment:
      "This summary is patient-authored. Full historical PDFs are referenced by DocumentReferences in the accompanying FHIR bundle.",
    audience: "general",
    authorNote: "patient-authored",
  },
  "morgan-gleason-clinical-summary-and-timeline.pdf",
);

// 4 — measurements (timeline of Observations)
await renderAndSave(
  "render_timeline_pdf",
  {
    patientName,
    entries: timeline.length
      ? timeline
      : [{ date: "2020-01-01", event: "No dated events found in bundle" }],
  },
  "measurements.pdf",
);

console.log(`\n✓ All 4 priority PDFs regenerated in ${DOCS_DIR}`);
console.log(`\nCommit + deploy:`);
const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(DOCS_DIR))));
console.log(`  cd ${repoRoot}`);
console.log(`  git add public/shl/morgan/docs/*.pdf`);
console.log(`  git commit -m "regenerate priority summary PDFs via KTC MCP"`);
console.log(`  git push`);

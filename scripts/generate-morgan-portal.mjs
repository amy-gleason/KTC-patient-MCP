#!/usr/bin/env node
/**
 * Generate a professional web portal for Morgan's medical records.
 *
 * Any clinician with the URL sees:
 *   - Patient identity + demographics
 *   - Problem list, medication list, allergies, procedures, immunizations
 *   - Full table of every DocumentReference with title, date, direct link
 *
 * Works in any browser. No SHL viewer needed. Reliable.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/generate-morgan-portal.mjs
 *   # writes public/shl/morgan/index.html in the Morgan-SHl repo, ready to deploy
 */

import { decryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { writeFileSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";

const JWE_URL =
  process.env.MORGAN_JWE_URL ||
  "https://morgans-shl.vercel.app/shl/morgan/file.jwe";
const KEY = base64UrlDecode(
  process.env.MORGAN_KEY || "qcL0Ww-PF9VPysTlK-NnHyQeWgBVVIPuiC06zxb4hxc",
);
const PORTAL_PATH =
  process.env.MORGAN_PORTAL_PATH ||
  path.join(
    homedir(),
    "Documents/GitHub/Morgan-SHl/public/shl/morgan/index.html",
  );
const SUMMARY_PDF_URL =
  process.env.MORGAN_SUMMARY_URL ||
  "./docs/morgan-gleason-clinical-summary-and-timeline.pdf";
const ZIP_URL =
  process.env.MORGAN_ZIP_URL ||
  "https://github.com/amy-gleason/Morgan-SHl/releases/download/morgan-large-docs/morgan-all-documents.zip";

console.log(`Fetching Morgan bundle from ${JWE_URL}...`);
const res = await fetch(JWE_URL, { cache: "no-store" });
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle: ${bundle.entry.length} entries`);

// --- Extract patient info ---
const patient = bundle.entry.find(
  (e) => e.resource?.resourceType === "Patient",
)?.resource;
const nm = patient?.name?.[0];
const patientName = nm
  ? `${(nm.given || []).join(" ")} ${nm.family || ""}`.trim()
  : "Patient";
const patientDob = patient?.birthDate || "";
const patientGender = patient?.gender || "";

// --- Extract structured data ---
const conditions = bundle.entry
  .filter((e) => e.resource?.resourceType === "Condition")
  .map((e) => ({
    text: e.resource.code?.text || e.resource.code?.coding?.[0]?.display || "Unknown",
    onset: e.resource.onsetDateTime?.slice(0, 10) || "",
    status: e.resource.clinicalStatus?.coding?.[0]?.code || "active",
  }));

const medications = bundle.entry
  .filter((e) => e.resource?.resourceType === "MedicationStatement")
  .map((e) => ({
    text: e.resource.medicationCodeableConcept?.text || e.resource.medicationCodeableConcept?.coding?.[0]?.display || "Unknown",
    status: e.resource.status || "active",
  }));

const allergies = bundle.entry
  .filter((e) => e.resource?.resourceType === "AllergyIntolerance")
  .map((e) => ({
    text: e.resource.code?.text || e.resource.code?.coding?.[0]?.display || "Unknown",
    severity: e.resource.reaction?.[0]?.severity || "",
  }));

const procedures = bundle.entry
  .filter((e) => e.resource?.resourceType === "Procedure")
  .map((e) => ({
    text: e.resource.code?.text || e.resource.code?.coding?.[0]?.display || "Unknown",
    date: e.resource.performedDateTime?.slice(0, 10) || "",
  }))
  .sort((a, b) => b.date.localeCompare(a.date));

const immunizations = bundle.entry
  .filter((e) => e.resource?.resourceType === "Immunization")
  .map((e) => ({
    text: e.resource.vaccineCode?.text || e.resource.vaccineCode?.coding?.[0]?.display || "Unknown",
    date: e.resource.occurrenceDateTime?.slice(0, 10) || "",
  }))
  .sort((a, b) => b.date.localeCompare(a.date));

const observations = bundle.entry
  .filter((e) => e.resource?.resourceType === "Observation")
  .map((e) => {
    const r = e.resource;
    const text = r.code?.text || r.code?.coding?.[0]?.display || "Observation";
    let value = "";
    if (r.valueQuantity)
      value = `${r.valueQuantity.value} ${r.valueQuantity.unit || ""}`.trim();
    else if (r.valueString) value = r.valueString;
    else if (r.valueCodeableConcept)
      value = r.valueCodeableConcept.text || r.valueCodeableConcept.coding?.[0]?.display || "";
    return { text, value, date: r.effectiveDateTime?.slice(0, 10) || "" };
  })
  .sort((a, b) => b.date.localeCompare(a.date));

// --- Extract documents ---
const documents = [];
for (const e of bundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  for (const c of dr.content ?? []) {
    const a = c.attachment;
    if (!a?.url) continue;
    const period = dr.context?.period;
    const dateSort = (dr.date || period?.end || "").slice(0, 10);
    const dateDisplay = period && period.start && period.end
      ? `${period.start.slice(0, 4)}–${period.end.slice(0, 4)}`
      : dateSort;
    documents.push({
      title: dr.description || a.title || "Untitled document",
      subtitle: (dr.description && a.title && dr.description !== a.title) ? a.title : "",
      dateDisplay,
      dateSort,
      contentType: a.contentType || "application/pdf",
      size: a.size || 0,
      url: a.url,
      typeCode: dr.type?.coding?.[0]?.display || dr.type?.text || "",
    });
  }
}
documents.sort((a, b) => b.dateSort.localeCompare(a.dateSort));

console.log(`Extracted: ${conditions.length} conditions, ${medications.length} meds, ${allergies.length} allergies, ${procedures.length} procedures, ${observations.length} observations, ${documents.length} documents`);

// --- Generate HTML ---
function esc(s) {
  return String(s || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtSize(n) {
  if (!n) return "";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(patientName)} — Medical Records</title>
<style>
  :root {
    --bg: #fafafa;
    --card: #ffffff;
    --border: #e5e7eb;
    --text: #111827;
    --muted: #6b7280;
    --accent: #0b3d91;
    --accent-hover: #082963;
    --warning-bg: #fef3c7;
    --warning-border: #fbbf24;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", sans-serif;
    background: var(--bg);
    color: var(--text);
    line-height: 1.5;
  }
  .container {
    max-width: 1100px;
    margin: 0 auto;
    padding: 24px;
  }
  header {
    background: var(--accent);
    color: white;
    padding: 24px 0;
    margin-bottom: 24px;
  }
  header .container { padding-top: 0; padding-bottom: 0; }
  h1 { margin: 0 0 8px 0; font-size: 28px; font-weight: 600; }
  .subtitle { opacity: 0.9; font-size: 15px; }
  .card {
    background: var(--card);
    border: 1px solid var(--border);
    border-radius: 8px;
    padding: 20px;
    margin-bottom: 20px;
  }
  h2 {
    margin: 0 0 16px 0;
    font-size: 18px;
    font-weight: 600;
    color: var(--accent);
    border-bottom: 2px solid var(--border);
    padding-bottom: 8px;
  }
  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
    gap: 16px;
  }
  ul { margin: 0; padding-left: 20px; }
  ul li { margin-bottom: 6px; }
  .muted { color: var(--muted); font-size: 14px; }
  .warning {
    background: var(--warning-bg);
    border: 1px solid var(--warning-border);
    border-radius: 6px;
    padding: 12px 16px;
    margin-bottom: 20px;
    font-size: 14px;
  }
  .hero {
    background: linear-gradient(135deg, #0b3d91 0%, #1e40af 100%);
    color: white;
    border-radius: 12px;
    padding: 32px;
    margin-bottom: 24px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.08);
  }
  .hero h2 {
    color: white;
    border: none;
    padding: 0;
    margin: 0 0 8px 0;
    font-size: 24px;
  }
  .hero p {
    margin: 0 0 20px 0;
    opacity: 0.95;
    font-size: 16px;
  }
  .hero-actions {
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }
  .hero-btn {
    display: inline-flex;
    align-items: center;
    gap: 8px;
    background: white;
    color: var(--accent);
    padding: 14px 24px;
    border-radius: 8px;
    font-weight: 600;
    text-decoration: none;
    font-size: 15px;
    transition: transform 0.1s;
  }
  .hero-btn:hover {
    transform: translateY(-1px);
    text-decoration: none;
    color: var(--accent-hover);
  }
  .hero-btn.secondary {
    background: transparent;
    color: white;
    border: 2px solid rgba(255,255,255,0.6);
  }
  .hero-btn.secondary:hover {
    background: rgba(255,255,255,0.1);
    color: white;
    border-color: white;
  }
  .hero-btn-icon {
    font-size: 18px;
    line-height: 1;
  }
  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 14px;
  }
  th, td {
    text-align: left;
    padding: 8px 12px;
    border-bottom: 1px solid var(--border);
  }
  th {
    background: #f3f4f6;
    font-weight: 600;
    position: sticky;
    top: 0;
    z-index: 1;
  }
  tr:hover { background: #f9fafb; }
  a {
    color: var(--accent);
    text-decoration: none;
  }
  a:hover { color: var(--accent-hover); text-decoration: underline; }
  input[type=search] {
    width: 100%;
    padding: 10px 12px;
    font-size: 14px;
    border: 1px solid var(--border);
    border-radius: 6px;
    margin-bottom: 12px;
  }
  .doc-count { color: var(--muted); font-size: 13px; margin-bottom: 8px; }
  .table-wrapper { max-height: 600px; overflow: auto; border: 1px solid var(--border); border-radius: 6px; }
  footer {
    margin-top: 40px;
    padding-top: 20px;
    border-top: 1px solid var(--border);
    color: var(--muted);
    font-size: 13px;
    text-align: center;
  }
  @media print {
    header { background: white; color: black; border-bottom: 2px solid black; }
    .warning, input[type=search] { display: none; }
    .table-wrapper { max-height: none; overflow: visible; }
    th { position: static; }
  }
</style>
</head>
<body>
<header>
  <div class="container">
    <h1>${esc(patientName)}</h1>
    <div class="subtitle">
      ${patientDob ? `DOB ${esc(patientDob)}` : ""}${patientGender ? `  ·  ${esc(patientGender)}` : ""}  ·  Patient-authored medical record  ·  ${bundle.entry.length} FHIR resources  ·  ${documents.length} source documents
    </div>
  </div>
</header>

<div class="container">
  <div class="hero">
    <h2>Complete Medical Summary and Timeline</h2>
    <p>For a full narrative summary of ${esc(patientName.split(" ")[0] || "the patient")}'s care — history, current regimen, active issues, and a reverse-chronological timeline — start here.</p>
    <div class="hero-actions">
      <a href="${esc(SUMMARY_PDF_URL)}" target="_blank" rel="noopener" class="hero-btn">
        <span class="hero-btn-icon">📄</span>
        Open Clinical Summary &amp; Timeline (PDF)
      </a>
      <a href="${esc(ZIP_URL)}" class="hero-btn secondary" download>
        <span class="hero-btn-icon">⬇</span>
        Download All ${documents.length} Documents (ZIP)
      </a>
    </div>
  </div>

  <div class="warning">
    <strong>For clinicians:</strong> Structured data (problems, meds, allergies)
    is below. Every source document is linked in the table at the bottom.
    Full FHIR bundle: <a href="./file.jwe">file.jwe</a> (SHL-encrypted).
  </div>

  ${(() => {
    const cards = [];
    if (conditions.length) cards.push(`<div class="card">
      <h2>Problem List (${conditions.length})</h2>
      <ul>${conditions.map(c => `<li>${esc(c.text)}${c.onset ? ` <span class="muted">(onset ${esc(c.onset)})</span>` : ""}</li>`).join("")}</ul>
    </div>`);
    if (medications.length) cards.push(`<div class="card">
      <h2>Medications (${medications.length})</h2>
      <ul>${medications.map(m => `<li>${esc(m.text)}${m.status && m.status !== "active" ? ` <span class="muted">(${esc(m.status)})</span>` : ""}</li>`).join("")}</ul>
    </div>`);
    if (allergies.length) cards.push(`<div class="card">
      <h2>Allergies (${allergies.length})</h2>
      <ul>${allergies.map(a => `<li>${esc(a.text)}${a.severity ? ` <span class="muted">(${esc(a.severity)})</span>` : ""}</li>`).join("")}</ul>
    </div>`);
    if (immunizations.length >= 2) cards.push(`<div class="card">
      <h2>Immunizations (${immunizations.length})</h2>
      <ul>${immunizations.slice(0, 30).map(i => `<li>${esc(i.text)}${i.date ? ` <span class="muted">(${esc(i.date)})</span>` : ""}</li>`).join("")}${immunizations.length > 30 ? `<li class="muted">... and ${immunizations.length - 30} more</li>` : ""}</ul>
    </div>`);
    return cards.length ? `<div class="grid">${cards.join("")}</div>` : "";
  })()}

  <div class="card">
    <h2>Procedures (${procedures.length})</h2>
    ${procedures.length ? `<ul style="columns: 2; column-gap: 32px;">${procedures.slice(0, 60).map(p => `<li>${esc(p.text)}${p.date ? ` <span class="muted">(${esc(p.date)})</span>` : ""}</li>`).join("")}</ul>${procedures.length > 60 ? `<p class="muted">... and ${procedures.length - 60} more</p>` : ""}` : `<p class="muted">No procedures recorded.</p>`}
  </div>

  ${observations.length ? `<div class="card">
    <h2>Recent Observations (${observations.length})</h2>
    <div class="table-wrapper" style="max-height: 300px;">
      <table>
        <thead><tr><th>Date</th><th>Observation</th><th>Value</th></tr></thead>
        <tbody>
          ${observations.slice(0, 100).map(o => `<tr><td>${esc(o.date)}</td><td>${esc(o.text)}</td><td>${esc(o.value)}</td></tr>`).join("")}
        </tbody>
      </table>
    </div>
    ${observations.length > 100 ? `<p class="muted">Showing 100 of ${observations.length}. Full data in the FHIR bundle.</p>` : ""}
  </div>` : ""}

  <div class="card">
    <h2>Source Documents (${documents.length})</h2>
    <input type="search" id="doc-search" placeholder="Filter by title, description, date, or type..." aria-label="Search documents">
    <div class="doc-count" id="doc-count">Showing ${documents.length} of ${documents.length} documents</div>
    <div class="table-wrapper">
      <table>
        <thead>
          <tr>
            <th>Date</th>
            <th>Document</th>
            <th>Type</th>
            <th>Size</th>
          </tr>
        </thead>
        <tbody id="doc-tbody">
          ${documents.map(d => `<tr data-search="${esc((d.title + " " + (d.subtitle || "") + " " + d.dateDisplay + " " + d.typeCode).toLowerCase())}">
            <td>${esc(d.dateDisplay)}</td>
            <td><a href="${esc(d.url)}" target="_blank" rel="noopener">${esc(d.title)}</a>${d.subtitle ? `<br><span class="muted">${esc(d.subtitle)}</span>` : ""}</td>
            <td>${esc(d.typeCode)}</td>
            <td>${esc(fmtSize(d.size))}</td>
          </tr>`).join("")}
        </tbody>
      </table>
    </div>
  </div>

  <footer>
    Patient-authored health summary. Generated ${new Date().toISOString().slice(0, 10)}.<br>
    SMART Health Link bundle: <a href="./file.jwe">file.jwe</a> (v${bundle.meta?.version || "1"}, ${bundle.entry.length} resources)
  </footer>
</div>

<script>
  // Simple client-side filter for the documents table
  const search = document.getElementById('doc-search');
  const tbody = document.getElementById('doc-tbody');
  const count = document.getElementById('doc-count');
  const rows = Array.from(tbody.querySelectorAll('tr'));
  const total = rows.length;
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase().trim();
    let visible = 0;
    for (const r of rows) {
      const match = !q || r.dataset.search.includes(q);
      r.style.display = match ? "" : "none";
      if (match) visible++;
    }
    count.textContent = 'Showing ' + visible + ' of ' + total + ' documents';
  });
</script>
</body>
</html>
`;

writeFileSync(PORTAL_PATH, html);
console.log(`\n✓ Wrote portal to ${PORTAL_PATH}`);
console.log(`  Size: ${(html.length / 1024).toFixed(1)} KB`);
console.log(`\nCommit + deploy:`);
const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(PORTAL_PATH))));
console.log(`  cd ${repoRoot}`);
console.log(`  git add public/shl/morgan/index.html`);
console.log(`  git commit -m "add clinician portal for Morgan's medical records"`);
console.log(`  git push`);
console.log(`\nOnce deployed, share this URL with NIH:`);
console.log(`  https://morgans-shl.vercel.app/shl/morgan/`);

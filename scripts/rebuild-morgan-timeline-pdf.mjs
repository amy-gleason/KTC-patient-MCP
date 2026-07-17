#!/usr/bin/env node
/**
 * Rebuild morgan-gleason-clinical-summary-and-timeline.pdf so it includes
 * the April 2026 Tennessee Oncology CAR-T visits (Byrne consult + CBC + CMP
 * + CCD). Matches the layout of the existing PDF:
 *
 *   Morgan Gleason — Timeline
 *   Consolidated clinical encounter history (2002 – <latest month year>)
 *
 *   <Month Year>
 *   [Mon]  <Visit Title>                Provider Notes: ...
 *   [ dd]  <Provider, Specialty>        Related Health Conditions: ...
 *          <Location>                   Related Medications: ...
 *                                       Related Procedures: ...
 *
 * Sources:
 *   1) RICH_ENTRIES below: 7 hand-authored entries for the visits whose source
 *      PDFs I've read (April 2026 Tennessee Oncology x4, plus Vanderbilt
 *      3/2025, 2/2025 cardiology, 3/2026).
 *   2) Encounter resources in the FHIR bundle (if any).
 *   3) DocumentReference resources (dated PDFs) as a last-resort fallback so
 *      pre-Vanderbilt encounters still appear.
 *
 * Duplicates (same date + provider) are collapsed with rich entries winning.
 *
 * Usage:
 *   cd ~/KTC-patient-MCP && npm run build
 *   node scripts/rebuild-morgan-timeline-pdf.mjs           # writes to docs dir
 *
 * Env:
 *   MORGAN_JWE_URL   default https://morgans-shl.vercel.app/shl/morgan/file.jwe
 *   MORGAN_KEY       default the well-known Morgan SHL key
 *   MORGAN_DOCS_DIR  default ~/Documents/GitHub/Morgan-SHl/public/shl/morgan/docs
 *   TIMELINE_OUT     default <DOCS_DIR>/morgan-gleason-clinical-summary-and-timeline.pdf
 */

import { decryptJwe } from "../dist/backend/jwe.js";
import { base64UrlDecode } from "../dist/backend/crypto.js";
import { writeFileSync, existsSync, createWriteStream } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import PDFDocument from "pdfkit";

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
const OUT_PATH =
  process.env.TIMELINE_OUT ||
  path.join(DOCS_DIR, "morgan-gleason-clinical-summary-and-timeline.pdf");

if (!existsSync(DOCS_DIR)) {
  console.error(`Docs directory does not exist: ${DOCS_DIR}`);
  process.exit(1);
}

// ---------------------------------------------------------------- rich entries
// Hand-authored from the 7 source PDFs Amy provided.
const RICH_ENTRIES = [
  {
    date: "2026-04-24",
    title: "Initial CAR-T Consultation",
    provider: "Byrne, Michael, MD",
    specialty: "Hematology / Oncology",
    location: "Tennessee Oncology — Nashville",
    notes:
      "27 y.o. with refractory juvenile dermatomyositis (TIF-1γ positive, ~16-year disease course); referred by Vanderbilt Rheumatology for CD19 CAR-T evaluation. History of inadequate response to IVIG, tacrolimus/tofacitinib, mycophenolate, chronic prednisone. Discussed autologous CD19 CAR-T; identified as candidate. Plan: coordinate with Dr. Young-Glazer (Vanderbilt Rheum) and Dr. Lisa Rider at NIH; pursue compassionate-use vs. clinical trial site (Tennessee Oncology, Colorado, or NIH). Baseline CBC and CMP obtained; return after NIH decision.",
    conditions: [
      "Juvenile dermatomyositis (refractory, TIF-1γ+)",
      "Calcinosis",
      "GERD",
      "Dysphagia",
      "Long-term systemic steroid use",
    ],
    medications: [
      "IVIG (Gamunex-C) 40 g/day × 2d q4wk via Option Care",
      "Tofacitinib (Xeljanz) 5 mg BID",
      "Mycophenolate mofetil (CellCept) 1 g BID",
      "Prednisone 40 mg daily",
      "Pantoprazole",
      "Cholecalciferol",
    ],
    procedures: [
      "CBC with differential",
      "Comprehensive metabolic panel",
      "C-CDA continuity-of-care document generated",
    ],
  },
  {
    date: "2026-04-24",
    title: "CBC (baseline for CAR-T workup)",
    provider: "Byrne, Michael, MD",
    specialty: "Laboratory",
    location: "Tennessee Oncology — Nashville",
    notes:
      "CBC with differential drawn as part of CAR-T baseline workup. Mild leukopenia (WBC 4.3 K/µL), mild neutropenia (ANC 1.6), and mild normocytic anemia (Hgb 11.9 g/dL, Hct 36.4%). Platelets normal (261 K/µL). Findings consistent with chronic immunosuppression; no acute cytopenias precluding lymphodepletion.",
    procedures: ["CBC with differential"],
  },
  {
    date: "2026-04-24",
    title: "Comprehensive Metabolic Panel",
    provider: "Byrne, Michael, MD",
    specialty: "Laboratory",
    location: "Tennessee Oncology — Nashville",
    notes:
      "CMP drawn during CAR-T consultation. Notable: AST 46 U/L (mildly elevated, ref <34); ALT within normal limits. Renal function preserved (creatinine 0.85, eGFR 87 AA / 72 non-AA). Sodium, potassium, chloride, bicarbonate, glucose, albumin, and total protein all within normal limits. No acute metabolic or hepatic contraindication to CAR-T lymphodepletion.",
    procedures: ["Comprehensive metabolic panel"],
  },
  {
    date: "2026-04-24",
    title: "Continuity of Care Document",
    provider: "Tennessee Oncology",
    specialty: "Handoff document (C-CDA)",
    location: "Tennessee Oncology — Nashville",
    notes:
      "C-CDA continuity-of-care document generated after the 2026-04-24 CAR-T consultation with Dr. Byrne. Contains the current problem list (JDM, calcinosis, GERD, dysphagia, myopathy, insomnia), 16-medication list, NKA allergy status, vitals, most recent labs, procedure history, and an embedded assessment/plan for CD19 CAR-T evaluation with a longitudinal timeline (2002–2026). Intended as a single-document handoff for referring specialists and NIH.",
  },
  {
    date: "2026-03-27",
    title: "Juvenile Dermatomyositis Follow-up",
    provider: "Young-Glazer, Jennifer Jordan, MD",
    specialty: "Rheumatology",
    location: "Vanderbilt Lung Institute One Hundred Oaks",
    notes:
      "27 y.o. with PMH JDM historically difficult to control. Interval: recent flare after missed IVIG doses (insurance denial); IVIG resumed November 2025. Left ankle ligament repair February 2026, healing well. Assessment: mild Gottron's papules, subjective proximal weakness, MMT strength 5/5 throughout; TIF-1γ-positive myositis panel reconfirmed; CK 69, ANA 1:640 speckled. Plan: continue IVIG 40 g/day × 2d q4wk, tofacitinib 5 mg BID, MMF 1 g BID, prednisone 40 mg daily. Short hydrocodone course for post-infusion headaches. CK/CBC/CMP/IgA ordered. Does not qualify for CAR-T (UC). RTC 3 months with Dr. Maldonado.",
    conditions: [
      "Juvenile dermatomyositis",
      "Ulcerative colitis",
      "Undifferentiated inflammatory polyarthritis",
      "GERD",
      "Frequent headaches",
      "Long-term systemic steroid use",
    ],
    medications: [
      "Hydroxychloroquine (Plaquenil)",
      "MMF 1 g BID (CellCept)",
      "Hydrocodone/APAP (Norco) PRN",
      "Prednisone 40 mg daily",
      "IVIG Gamunex-C via Option Care",
    ],
    procedures: ["CK", "CBC w/ differential", "CMP", "IgA"],
  },
  {
    date: "2025-03-21",
    title: "Juvenile Dermatomyositis Follow-up",
    provider: "Young-Glazer, Jennifer Jordan, MD",
    specialty: "Rheumatology",
    location: "Vanderbilt Lung Institute One Hundred Oaks",
    notes:
      "26 y.o. with JDM; mild skin disease with Gottron's and mild weakness (recent flare); otherwise well controlled. MMT-8 144/150. Plan: continue IVIG, tofacitinib, MMF; taper prednisone 40→30→20→10 mg (one week each). Recheck myositis autoantibody panel, CK/aldolase, TSH/FT4, infectious studies, Vitamin D. Does not qualify for the University of Colorado CAR-T trial (severity criteria not met). RTC 3 months.",
    procedures: [
      "Myositis autoantibody panel",
      "CK / aldolase",
      "CMP, CBC",
      "TSH / FT4",
      "Vitamin D",
    ],
  },
  {
    date: "2025-02-10",
    title: "Cardiology consultation",
    provider: "Kiasatpour, Barbara Ann, NP",
    specialty: "Cardiology",
    location: "Vanderbilt Heart Institute",
    notes:
      "Cardiology consult referred from rheumatology for evaluation of intermittent tachycardia in the setting of juvenile dermatomyositis. Note: this document was previously mislabeled in the SHL bundle as a Young-Glazer rheumatology visit — it is in fact a Vanderbilt Heart Institute after-visit summary with NP Kiasatpour. Assessment and plan documented in the AVS only; patient instructed to continue current cardiac monitoring and return to rheumatology as scheduled. No new cardiac medications initiated at this visit.",
  },
];

// ------------------------------------------------------------- fetch + extract
console.log(`Fetching bundle from ${JWE_URL}...`);
const res = await fetch(JWE_URL, { cache: "no-store" });
if (!res.ok) {
  console.error(`Failed to fetch bundle: HTTP ${res.status}`);
  process.exit(1);
}
const bundle = JSON.parse(decryptJwe(await res.text(), KEY).toString("utf8"));
console.log(`Bundle: ${bundle.entry.length} entries`);

const patient = bundle.entry.find(
  (e) => e.resource?.resourceType === "Patient",
)?.resource;
const nm = patient?.name?.[0];
const patientName = nm
  ? `${(nm.given || []).join(" ")} ${nm.family || ""}`.trim()
  : "Patient";

// ---------- Encounter-derived entries (light: title/provider/location only)
const encounterEntries = [];
for (const e of bundle.entry ?? []) {
  const r = e.resource;
  if (r?.resourceType !== "Encounter") continue;
  const date = (r.period?.start || r.period?.end || "").slice(0, 10);
  if (!date) continue;
  const title =
    r.type?.[0]?.text ||
    r.type?.[0]?.coding?.[0]?.display ||
    r.class?.display ||
    "Encounter";
  const providerRef = r.participant?.find(
    (p) => p.individual?.display,
  )?.individual?.display;
  const location =
    r.location?.[0]?.location?.display || r.serviceProvider?.display || "";
  encounterEntries.push({
    date,
    title,
    provider: providerRef || "",
    specialty: r.class?.display || "",
    location,
    notes: r.reasonCode?.[0]?.text || "",
    _source: "encounter",
  });
}

// ---------- DocumentReference-derived entries (last-resort fallback for dates
// without a matching Encounter; used to preserve the 2002–2024 historical
// record so the timeline isn't blank pre-Vanderbilt).
const docEntries = [];
for (const e of bundle.entry ?? []) {
  const dr = e.resource;
  if (dr?.resourceType !== "DocumentReference") continue;
  const period = dr.context?.period;
  const date = (dr.date || period?.end || period?.start || "").slice(0, 10);
  if (!date) continue;
  const att = dr.content?.[0]?.attachment;
  const title = att?.title || dr.type?.text || dr.type?.coding?.[0]?.display || "Clinical document";
  const author = dr.author?.[0]?.display || "";
  docEntries.push({
    date,
    title,
    provider: author,
    specialty: dr.category?.[0]?.text || dr.category?.[0]?.coding?.[0]?.display || "",
    location: dr.context?.facilityType?.text || "",
    notes: dr.description || "",
    _source: "docref",
  });
}

// ---------- Merge, dedup, sort. Rich entries win. Rich + Encounter for same
// (date, provider) collapse. Doc-only entries appear only when neither exists.
function key(e) {
  return `${e.date}|${(e.provider || "").toLowerCase().split(",")[0]}`;
}
const seen = new Map();
for (const e of RICH_ENTRIES) seen.set(key(e), { ...e, _source: "rich" });
for (const e of encounterEntries) {
  const k = key(e);
  if (seen.has(k)) continue;
  seen.set(k, e);
}
for (const e of docEntries) {
  const k = key(e);
  if (seen.has(k)) continue;
  // For doc-only entries, also collapse near-duplicate titles on same date
  const dateOnlyDup = [...seen.values()].some(
    (v) => v.date === e.date && v.title === e.title,
  );
  if (dateOnlyDup) continue;
  seen.set(k, e);
}
const entries = [...seen.values()].sort((a, b) => b.date.localeCompare(a.date));

const earliestYear = entries.length
  ? entries[entries.length - 1].date.slice(0, 4)
  : "2002";
const latestDate = entries.length ? entries[0].date : "";
const latestMonth = latestDate
  ? new Date(latestDate + "T00:00:00Z").toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    })
  : "present";

console.log(
  `Timeline entries: ${entries.length}` +
    ` (rich=${RICH_ENTRIES.length}, encounter=${encounterEntries.length}, docref-fallback=${docEntries.length})`,
);
console.log(`Range: ${earliestYear} – ${latestMonth}`);

// ------------------------------------------------------------ render the PDF
const doc = new PDFDocument({
  size: "LETTER",
  margins: { top: 54, bottom: 54, left: 54, right: 54 },
  bufferPages: true,
  info: {
    Title: `${patientName} — Timeline`,
    Author: patientName,
    Subject: "Consolidated clinical encounter history",
    Producer: "Morgan-SHl / KTC-patient-MCP",
  },
});
const stream = createWriteStream(OUT_PATH);
doc.pipe(stream);

const MONO = "Courier";
const SANS = "Helvetica";
const SANS_BOLD = "Helvetica-Bold";
const SANS_ITALIC = "Helvetica-Oblique";

const COLOR_TEXT = "#111827";
const COLOR_MUTED = "#6b7280";
const COLOR_ACCENT = "#0b3d91";
const COLOR_RULE = "#e5e7eb";

const PAGE_LEFT = 54;
const PAGE_RIGHT = 612 - 54;      // 8.5" - right margin
const PAGE_BOTTOM = 792 - 54;     // 11" - bottom margin
const DATE_COL_W = 60;
const VISIT_COL_X = PAGE_LEFT + DATE_COL_W + 12;
const NOTES_COL_X = 288;
const NOTES_COL_W = PAGE_RIGHT - NOTES_COL_X;
const VISIT_COL_W = NOTES_COL_X - VISIT_COL_X - 12;

function ensureRoom(needed) {
  if (doc.y + needed > PAGE_BOTTOM) doc.addPage();
}

function drawMonthHeader(label) {
  ensureRoom(40);
  doc
    .font(SANS_BOLD)
    .fontSize(16)
    .fillColor(COLOR_TEXT)
    .text(label, PAGE_LEFT, doc.y, { width: PAGE_RIGHT - PAGE_LEFT });
  doc
    .moveTo(PAGE_LEFT, doc.y + 2)
    .lineTo(PAGE_RIGHT, doc.y + 2)
    .strokeColor(COLOR_RULE)
    .lineWidth(1)
    .stroke();
  doc.moveDown(0.6);
}

function drawEntry(entry) {
  const startY = doc.y;

  // Date block (left col)
  const d = new Date(entry.date + "T00:00:00Z");
  const monAbbr = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  const dayNum = String(d.getUTCDate()).padStart(2, " ");
  doc
    .font(SANS)
    .fontSize(9)
    .fillColor(COLOR_MUTED)
    .text(monAbbr, PAGE_LEFT, startY, { width: DATE_COL_W, align: "left" });
  doc
    .font(SANS_BOLD)
    .fontSize(22)
    .fillColor(COLOR_TEXT)
    .text(dayNum, PAGE_LEFT, startY + 10, {
      width: DATE_COL_W,
      align: "left",
    });

  // Visit block (middle col)
  let vY = startY;
  doc
    .font(SANS_BOLD)
    .fontSize(12)
    .fillColor(COLOR_TEXT)
    .text(entry.title || "Encounter", VISIT_COL_X, vY, { width: VISIT_COL_W });
  vY = doc.y + 1;
  if (entry.provider) {
    doc
      .font(SANS)
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(entry.provider, VISIT_COL_X, vY, { width: VISIT_COL_W });
    vY = doc.y;
  }
  if (entry.specialty) {
    doc
      .font(SANS_ITALIC)
      .fontSize(10)
      .fillColor(COLOR_MUTED)
      .text(entry.specialty, VISIT_COL_X, vY, { width: VISIT_COL_W });
    vY = doc.y;
  }
  if (entry.location) {
    doc
      .font(SANS)
      .fontSize(9)
      .fillColor(COLOR_MUTED)
      .text(entry.location, VISIT_COL_X, vY, { width: VISIT_COL_W });
    vY = doc.y;
  }
  const visitBlockEnd = vY;

  // Notes block (right col)
  let nY = startY;
  const drawLabeledPara = (label, body) => {
    if (!body) return;
    doc
      .font(SANS_BOLD)
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(label + " ", NOTES_COL_X, nY, {
        width: NOTES_COL_W,
        continued: true,
      })
      .font(SANS)
      .fillColor(COLOR_TEXT)
      .text(body, { width: NOTES_COL_W });
    nY = doc.y + 4;
  };
  const drawLabeledList = (label, items) => {
    if (!items?.length) return;
    doc
      .font(SANS_BOLD)
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(label, NOTES_COL_X, nY, { width: NOTES_COL_W });
    nY = doc.y + 1;
    doc
      .font(SANS)
      .fontSize(10)
      .fillColor(COLOR_TEXT)
      .text(items.join("; ") + ".", NOTES_COL_X, nY, {
        width: NOTES_COL_W,
      });
    nY = doc.y + 4;
  };

  drawLabeledPara("Provider Notes:", entry.notes);
  drawLabeledList("Related Health Conditions:", entry.conditions);
  drawLabeledList("Related Medications:", entry.medications);
  drawLabeledList("Related Procedures:", entry.procedures);
  const notesBlockEnd = nY;

  const bottom = Math.max(visitBlockEnd, notesBlockEnd) + 12;
  doc
    .moveTo(PAGE_LEFT, bottom - 6)
    .lineTo(PAGE_RIGHT, bottom - 6)
    .strokeColor(COLOR_RULE)
    .lineWidth(0.5)
    .stroke();
  doc.y = bottom;

  // If we're too close to the bottom for the next entry, break the page.
  if (doc.y > PAGE_BOTTOM - 60) doc.addPage();
}

// ---------- Header
doc.font(SANS_BOLD).fontSize(28).fillColor(COLOR_TEXT).text(`${patientName} — Timeline`);
doc.moveDown(0.2);
doc
  .font(SANS)
  .fontSize(12)
  .fillColor(COLOR_MUTED)
  .text(`Consolidated clinical encounter history (${earliestYear} – ${latestMonth})`);
doc.moveDown(0.8);
doc
  .rect(PAGE_LEFT, doc.y, PAGE_RIGHT - PAGE_LEFT, 44)
  .fillColor("#f3f4f6")
  .fill();
doc
  .font(SANS)
  .fontSize(10)
  .fillColor(COLOR_TEXT)
  .text(
    "Reverse-chronological list of documented encounters. Recent entries (Feb 2025 onward) are authored from Vanderbilt University Medical Center and Tennessee Oncology source documents. Earlier entries are derived from the FHIR bundle (CareSync Member Health Summary export 12/12/2018 and later ingestions).",
    PAGE_LEFT + 12,
    doc.y + 8,
    { width: PAGE_RIGHT - PAGE_LEFT - 24 },
  );
doc.y = doc.y + 12;
doc.moveDown(1);

// ---------- Group by month
let currentMonthKey = "";
for (const e of entries) {
  const d = new Date(e.date + "T00:00:00Z");
  const mk = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  if (mk !== currentMonthKey) {
    currentMonthKey = mk;
    const label = d.toLocaleString("en-US", {
      month: "long",
      year: "numeric",
      timeZone: "UTC",
    });
    drawMonthHeader(label);
  }
  ensureRoom(60);
  drawEntry(e);
}

// ---------- Footer on every page
const range = doc.bufferedPageRange();
for (let i = 0; i < range.count; i++) {
  doc.switchToPage(range.start + i);
  doc
    .font(SANS)
    .fontSize(8)
    .fillColor(COLOR_MUTED)
    .text(
      `${patientName} — Timeline · Page ${i + 1} of ${range.count} · Generated ${new Date().toISOString().slice(0, 10)}`,
      PAGE_LEFT,
      PAGE_BOTTOM + 10,
      { width: PAGE_RIGHT - PAGE_LEFT, align: "center" },
    );
}

doc.end();

await new Promise((resolve, reject) => {
  stream.on("finish", resolve);
  stream.on("error", reject);
});

console.log(`\n✓ Wrote ${OUT_PATH}`);
const repoRoot = path.dirname(path.dirname(path.dirname(path.dirname(DOCS_DIR))));
console.log(`\nDeploy:`);
console.log(`  cd ${repoRoot}`);
console.log(`  git add public/shl/morgan/docs/morgan-gleason-clinical-summary-and-timeline.pdf`);
console.log(`  git commit -m "timeline: rebuild with April 2026 Tennessee Oncology CAR-T visits"`);
console.log(`  git push`);

import PDFDocument from "pdfkit";
import type { FhirBundle } from "./ips.js";
import type { InsuranceCardInput } from "./insurance.js";

/**
 * PDF rendering for clinical summary, timeline, IPS narrative, and insurance card.
 * Uses pdfkit (pure-JS, no Chromium). Style choices follow the handoff spec:
 * Georgia serif for clinical-looking documents, Helvetica for data tables.
 */

async function buildPdf(populate: (doc: typeof PDFDocument.prototype) => void): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({
      size: "LETTER",
      margins: { top: 54, bottom: 54, left: 54, right: 54 },
      info: { Producer: "ktc-patient-mcp" },
    });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
    try {
      populate(doc);
      doc.end();
    } catch (e) {
      reject(e);
    }
  });
}

function pageFooter(doc: typeof PDFDocument.prototype, title: string): void {
  const range = doc.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    doc.switchToPage(i);
    const bottom = doc.page.height - 36;
    doc
      .fontSize(8)
      .fillColor("#666")
      .font("Helvetica")
      .text(title, doc.page.margins.left, bottom, {
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        align: "center",
      })
      .text(
        `Page ${i - range.start + 1} of ${range.count}`,
        doc.page.margins.left,
        bottom + 12,
        {
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
          align: "right",
        },
      );
  }
}

// ============================================================================
// Clinical summary (Dr-Rider-style, ~3 pages)
// ============================================================================

export interface ClinicalSummaryInput {
  patientName: string;
  patientDob?: string;
  oneLiner: string; // "62 yo M with X presenting today for Y"
  history: string[]; // paragraphs
  currentRegimen: { medication: string; dose?: string; indication?: string }[];
  priorTherapies?: string; // single paragraph
  activeIssues: string[]; // numbered list
  assessment: string; // closing paragraph; if there's a "patient here today for X" ask, append it as the last sentence
  audience?: "oncologist" | "pcp" | "er" | "general";
  authorNote?: string; // e.g. "patient-authored"
  generatedDate?: string; // ISO; defaults to now
}

export async function renderClinicalSummaryPdf(input: ClinicalSummaryInput): Promise<Buffer> {
  const date = input.generatedDate ? new Date(input.generatedDate) : new Date();
  const dateStr = date.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return buildPdf((doc) => {
    // Header
    doc
      .font("Helvetica-Bold")
      .fontSize(16)
      .fillColor("#000")
      .text("Clinical Summary", { align: "left" });
    doc
      .font("Helvetica")
      .fontSize(9)
      .fillColor("#555")
      .text(
        `${input.patientName}${input.patientDob ? "  •  DOB " + input.patientDob : ""}  •  ${dateStr}` +
          (input.audience ? `  •  prepared for ${input.audience}` : "") +
          (input.authorNote ? `  •  ${input.authorNote}` : ""),
      );
    doc.moveDown(1);

    // Body — Georgia serif
    doc.font("Times-Roman").fontSize(11).fillColor("#000");

    // One-liner
    doc.font("Times-Italic").text(input.oneLiner, { align: "left" });
    doc.moveDown(0.8);

    // History
    if (input.history.length) {
      doc.font("Helvetica-Bold").fontSize(11).text("History");
      doc.moveDown(0.3);
      doc.font("Times-Roman").fontSize(11);
      for (const para of input.history) {
        doc.text(para, { align: "left" });
        doc.moveDown(0.4);
      }
      doc.moveDown(0.4);
    }

    // Current regimen — table
    if (input.currentRegimen.length) {
      doc.font("Helvetica-Bold").fontSize(11).text("Current Regimen");
      doc.moveDown(0.3);
      drawRegimenTable(doc, input.currentRegimen);
      doc.moveDown(0.6);
    }

    // Prior therapies
    if (input.priorTherapies) {
      doc.font("Helvetica-Bold").fontSize(11).text("Prior Therapies");
      doc.moveDown(0.3);
      doc.font("Times-Roman").fontSize(11).text(input.priorTherapies);
      doc.moveDown(0.6);
    }

    // Active issues — numbered list
    if (input.activeIssues.length) {
      doc.font("Helvetica-Bold").fontSize(11).text("Active Issues");
      doc.moveDown(0.3);
      doc.font("Times-Roman").fontSize(11);
      input.activeIssues.forEach((issue, i) => {
        doc.text(`${i + 1}. ${issue}`, { align: "left" });
        doc.moveDown(0.2);
      });
      doc.moveDown(0.4);
    }

    // Assessment
    doc.font("Helvetica-Bold").fontSize(11).text("Assessment");
    doc.moveDown(0.3);
    doc.font("Times-Roman").fontSize(11).text(input.assessment);

    pageFooter(doc, "Clinical Summary");
  });
}

function drawRegimenTable(
  doc: typeof PDFDocument.prototype,
  rows: ClinicalSummaryInput["currentRegimen"],
): void {
  const tableLeft = doc.page.margins.left;
  const usableWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const colW = [usableWidth * 0.4, usableWidth * 0.25, usableWidth * 0.35];
  const headerY = doc.y;

  doc.font("Helvetica-Bold").fontSize(9).fillColor("#000");
  doc.text("Medication", tableLeft, headerY, { width: colW[0] });
  doc.text("Dose", tableLeft + colW[0], headerY, { width: colW[1] });
  doc.text("Indication", tableLeft + colW[0] + colW[1], headerY, { width: colW[2] });
  doc
    .moveTo(tableLeft, headerY + 14)
    .lineTo(tableLeft + usableWidth, headerY + 14)
    .strokeColor("#999")
    .stroke();
  doc.y = headerY + 18;

  doc.font("Times-Roman").fontSize(10);
  for (const r of rows) {
    const rowY = doc.y;
    const heightCells = [
      doc.heightOfString(r.medication, { width: colW[0] }),
      doc.heightOfString(r.dose ?? "", { width: colW[1] }),
      doc.heightOfString(r.indication ?? "", { width: colW[2] }),
    ];
    const rowH = Math.max(...heightCells) + 4;
    doc.text(r.medication, tableLeft, rowY, { width: colW[0] });
    doc.text(r.dose ?? "", tableLeft + colW[0], rowY, { width: colW[1] });
    doc.text(r.indication ?? "", tableLeft + colW[0] + colW[1], rowY, { width: colW[2] });
    doc.y = rowY + rowH;
  }
}

// ============================================================================
// Timeline (3-column reverse-chronological, grouped by month)
// ============================================================================

export interface TimelineEntry {
  date: string; // ISO YYYY-MM-DD
  event: string;
  notes?: string;
  provider?: string;
  facility?: string;
}

export async function renderTimelinePdf(
  patientName: string,
  entries: TimelineEntry[],
): Promise<Buffer> {
  // Sort reverse-chronological.
  const sorted = [...entries].sort((a, b) => b.date.localeCompare(a.date));

  // Group by Year-Month.
  const groups = new Map<string, TimelineEntry[]>();
  for (const e of sorted) {
    const ym = e.date.slice(0, 7); // YYYY-MM
    const arr = groups.get(ym) ?? [];
    arr.push(e);
    groups.set(ym, arr);
  }

  return buildPdf((doc) => {
    doc.font("Helvetica-Bold").fontSize(16).text("Health Timeline");
    doc.font("Helvetica").fontSize(9).fillColor("#555").text(patientName);
    doc.moveDown(1);

    const left = doc.page.margins.left;
    const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const colW = [usable * 0.13, usable * 0.32, usable * 0.55];

    for (const [ym, arr] of groups) {
      const [y, m] = ym.split("-");
      const monthName = new Date(`${ym}-01`).toLocaleString("en-US", {
        month: "long",
        timeZone: "UTC",
      });
      const headerLabel = `${monthName} ${y}`;

      // Reserve space so we don't orphan the month header at page bottom.
      const firstRowHeight = estimateRowHeight(doc, arr[0], colW);
      if (doc.y + 24 + firstRowHeight > doc.page.height - doc.page.margins.bottom) {
        doc.addPage();
      }

      doc
        .font("Helvetica-Bold")
        .fontSize(13)
        .fillColor("#222")
        .text(headerLabel, left);
      doc
        .moveTo(left, doc.y + 2)
        .lineTo(left + usable, doc.y + 2)
        .strokeColor("#ccc")
        .stroke();
      doc.moveDown(0.4);

      for (const e of arr) {
        const rowH = estimateRowHeight(doc, e, colW);
        if (doc.y + rowH > doc.page.height - doc.page.margins.bottom) {
          doc.addPage();
        }
        const rowY = doc.y;
        doc.font("Helvetica-Bold").fontSize(9).fillColor("#444");
        doc.text(formatShortDate(e.date), left, rowY, { width: colW[0] });
        doc.font("Helvetica-Bold").fontSize(10).fillColor("#000");
        doc.text(e.event, left + colW[0], rowY, { width: colW[1] });
        if (e.provider || e.facility) {
          doc.font("Helvetica-Oblique").fontSize(8).fillColor("#666");
          doc.text(
            [e.provider, e.facility].filter(Boolean).join(" • "),
            left + colW[0],
            doc.y,
            { width: colW[1] },
          );
        }
        doc.font("Times-Roman").fontSize(10).fillColor("#222");
        doc.text(e.notes ?? "", left + colW[0] + colW[1], rowY, { width: colW[2] });
        // Move below the tallest column.
        doc.y = rowY + rowH;
        doc
          .moveTo(left, doc.y - 2)
          .lineTo(left + usable, doc.y - 2)
          .strokeColor("#eee")
          .stroke();
        doc.moveDown(0.2);
      }
      doc.moveDown(0.6);
    }

    pageFooter(doc, "Health Timeline");
  });
}

function estimateRowHeight(
  doc: typeof PDFDocument.prototype,
  e: TimelineEntry,
  colW: number[],
): number {
  doc.font("Helvetica-Bold").fontSize(10);
  const eventH = doc.heightOfString(e.event, { width: colW[1] });
  const subH = e.provider || e.facility
    ? doc.heightOfString([e.provider, e.facility].filter(Boolean).join(" • "), {
        width: colW[1],
      })
    : 0;
  doc.font("Times-Roman").fontSize(10);
  const notesH = doc.heightOfString(e.notes ?? "", { width: colW[2] });
  return Math.max(eventH + subH + 2, notesH) + 8;
}

function formatShortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return `${d.toLocaleString("en-US", { month: "short", timeZone: "UTC" })} ${d
    .getUTCDate()
    .toString()
    .padStart(2, "0")}`;
}

// ============================================================================
// IPS narrative (single-column, one section per <h2>)
// ============================================================================

interface CompositionSection {
  title?: string;
  text?: { div?: string };
  entry?: { reference: string }[];
}

function htmlToPlain(html?: string): string {
  if (!html) return "";
  return html
    .replace(/<\/li>/gi, "\n")
    .replace(/<li[^>]*>/gi, "  • ")
    .replace(/<\/p>/gi, "\n\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export async function renderIpsNarrativePdf(bundle: FhirBundle): Promise<Buffer> {
  const composition = bundle.entry.find(
    (e) => (e.resource as { resourceType?: string }).resourceType === "Composition",
  )?.resource as
    | (Record<string, unknown> & { section?: CompositionSection[]; title?: string; date?: string })
    | undefined;
  const patientEntry = bundle.entry.find(
    (e) => (e.resource as { resourceType?: string }).resourceType === "Patient",
  );
  const patient = patientEntry?.resource as
    | { name?: { given?: string[]; family?: string }[]; birthDate?: string }
    | undefined;
  const patientName = patient?.name?.[0]
    ? `${patient.name[0].given?.[0] ?? ""} ${patient.name[0].family ?? ""}`.trim()
    : "Patient";

  return buildPdf((doc) => {
    doc.font("Helvetica-Bold").fontSize(18).text("Patient Summary (IPS)");
    doc.font("Helvetica").fontSize(10).fillColor("#555").text(
      `${patientName}${patient?.birthDate ? "  •  DOB " + patient.birthDate : ""}  •  ${(composition?.date ?? new Date().toISOString()).slice(0, 10)}`,
    );
    doc.moveDown(1);

    for (const section of composition?.section ?? []) {
      doc.font("Helvetica-Bold").fontSize(13).fillColor("#000").text(section.title ?? "Section");
      doc.moveDown(0.3);
      doc.font("Times-Roman").fontSize(11);
      const plain = htmlToPlain(section.text?.div);
      doc.text(plain || "—", { align: "left" });
      doc.moveDown(0.8);
    }

    pageFooter(doc, "Patient Summary (IPS)");
  });
}

// ============================================================================
// Insurance card (wallet front + back, two pages)
// ============================================================================

export async function renderInsuranceCardPdf(card: InsuranceCardInput): Promise<Buffer> {
  return buildPdf((doc) => {
    drawCardFront(doc, card);
    doc.addPage();
    drawCardBack(doc, card);
    pageFooter(doc, `Insurance Card — ${card.payerName}`);
  });
}

function drawCardFront(doc: typeof PDFDocument.prototype, card: InsuranceCardInput): void {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cardH = 220;
  const cardY = doc.y;

  // Card frame
  doc.roundedRect(left, cardY, usable, cardH, 12).lineWidth(1).strokeColor("#222").stroke();

  // Header strip
  doc.fillColor("#0b3d91").rect(left, cardY, usable, 36).fill();
  doc
    .fillColor("#fff")
    .font("Helvetica-Bold")
    .fontSize(14)
    .text(card.payerName, left + 14, cardY + 11, { width: usable - 28 });
  doc.fillColor("#cfd8eb").font("Helvetica").fontSize(9);
  if (card.planName) doc.text(card.planName, left + 14, cardY + 26, { width: usable - 28 });

  // Body grid
  doc.fillColor("#222").font("Helvetica").fontSize(8);
  let bodyY = cardY + 50;
  const labelStyle = () => doc.font("Helvetica").fontSize(7).fillColor("#777");
  const valueStyle = () => doc.font("Helvetica-Bold").fontSize(11).fillColor("#000");

  labelStyle().text("MEMBER", left + 14, bodyY);
  valueStyle().text(card.memberName, left + 14, bodyY + 10, { width: usable / 2 - 14 });

  labelStyle().text("MEMBER ID", left + usable / 2, bodyY);
  valueStyle().text(card.memberId, left + usable / 2, bodyY + 10);

  bodyY += 44;

  if (card.groupNumber) {
    labelStyle().text("GROUP", left + 14, bodyY);
    valueStyle().text(card.groupNumber, left + 14, bodyY + 10);
  }
  if (card.order) {
    labelStyle().text("COVERAGE", left + usable / 2, bodyY);
    valueStyle().text(card.order.toUpperCase(), left + usable / 2, bodyY + 10);
  }
  bodyY += 40;

  if (card.rxBin || card.rxPcn || card.rxGroup) {
    const rxY = bodyY;
    labelStyle().text("RX BIN", left + 14, rxY);
    valueStyle().fontSize(10).text(card.rxBin ?? "—", left + 14, rxY + 10);
    labelStyle().text("RX PCN", left + 14 + usable * 0.25, rxY);
    valueStyle().fontSize(10).text(card.rxPcn ?? "—", left + 14 + usable * 0.25, rxY + 10);
    labelStyle().text("RX GROUP", left + 14 + usable * 0.5, rxY);
    valueStyle().fontSize(10).text(card.rxGroup ?? "—", left + 14 + usable * 0.5, rxY + 10);
    bodyY += 36;
  }

  if (card.effectiveDate || card.expirationDate) {
    labelStyle().text("EFFECTIVE", left + 14, bodyY);
    valueStyle().fontSize(10).text(card.effectiveDate ?? "—", left + 14, bodyY + 10);
    labelStyle().text("EXPIRES", left + 14 + usable * 0.25, bodyY);
    valueStyle().fontSize(10).text(card.expirationDate ?? "—", left + 14 + usable * 0.25, bodyY + 10);
  }

  doc.y = cardY + cardH + 16;
  doc.font("Helvetica").fontSize(8).fillColor("#777").text(
    "Front of card. Show this to providers and pharmacies.",
    left,
    doc.y,
    { width: usable, align: "center" },
  );
}

function drawCardBack(doc: typeof PDFDocument.prototype, card: InsuranceCardInput): void {
  const left = doc.page.margins.left;
  const usable = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  const cardH = 220;
  const cardY = doc.y;
  doc.roundedRect(left, cardY, usable, cardH, 12).strokeColor("#222").stroke();
  doc.font("Helvetica-Bold").fontSize(11).fillColor("#000").text("Customer Service & Claims", left + 14, cardY + 14);

  doc.font("Helvetica").fontSize(10).fillColor("#222");
  let y = cardY + 36;
  if (card.customerServicePhone) {
    doc.text(`Member Services: ${card.customerServicePhone}`, left + 14, y);
    y += 16;
  }
  if (card.providerPhone) {
    doc.text(`Provider Line:   ${card.providerPhone}`, left + 14, y);
    y += 16;
  }
  if (card.copay) {
    doc.text(`Copay: ${card.copay}`, left + 14, y);
    y += 16;
  }
  if (card.claimsAddress) {
    doc.text(`Submit Claims:`, left + 14, y);
    y += 14;
    doc.font("Helvetica-Oblique").fontSize(9).text(card.claimsAddress, left + 24, y, {
      width: usable - 48,
    });
  }
  if (card.dependents && card.dependents.length > 0) {
    doc.font("Helvetica-Bold").fontSize(10).fillColor("#000").text("Dependents Covered", left + 14, cardY + cardH - 80);
    doc.font("Helvetica").fontSize(9).fillColor("#222");
    let dy = cardY + cardH - 64;
    for (const d of card.dependents.slice(0, 4)) {
      doc.text(
        `• ${d.name}${d.relationship ? " (" + d.relationship + ")" : ""}${d.dateOfBirth ? "  DOB " + d.dateOfBirth : ""}`,
        left + 14,
        dy,
        { width: usable - 28 },
      );
      dy += 12;
    }
  }

  doc.y = cardY + cardH + 16;
  doc.font("Helvetica").fontSize(8).fillColor("#777").text(
    "Back of card. Reference this for billing questions.",
    left,
    doc.y,
    { width: usable, align: "center" },
  );
}

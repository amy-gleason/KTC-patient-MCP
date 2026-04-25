import { describe, expect, it } from "vitest";
import { buildIpsBundle } from "../src/health/ips.js";
import {
  renderClinicalSummaryPdf,
  renderIpsNarrativePdf,
  renderTimelinePdf,
} from "../src/health/render.js";

function isPdf(buf: Buffer): boolean {
  return buf.slice(0, 5).toString("ascii") === "%PDF-";
}

describe("PDF renderers", () => {
  it("renders a clinical summary PDF", async () => {
    const pdf = await renderClinicalSummaryPdf({
      patientName: "Pat Example",
      patientDob: "1970-01-01",
      oneLiner:
        "55 yo M with type 2 diabetes and hypertension presenting for medication review.",
      history: [
        "T2DM diagnosed 2015. A1c trending 6.8 → 7.2 over the last year.",
        "HTN diagnosed 2018, well-controlled on lisinopril.",
      ],
      currentRegimen: [
        { medication: "Metformin", dose: "500 mg PO BID", indication: "T2DM" },
        { medication: "Lisinopril", dose: "10 mg PO daily", indication: "HTN" },
      ],
      priorTherapies: "Atorvastatin 2018-2022, stopped due to myalgia.",
      activeIssues: ["Glycemic drift over last 6 months", "Routine lipid panel due"],
      assessment:
        "Stable on current regimen. Today: discuss adding GLP-1 if A1c remains >7.0 at next check.",
      audience: "pcp",
      authorNote: "patient-authored",
    });
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("renders a timeline PDF, reverse-chronological by month", async () => {
    const pdf = await renderTimelinePdf("Pat Example", [
      { date: "2024-03-12", event: "Annual physical", provider: "Dr. Smith", notes: "Routine. A1c 6.8." },
      { date: "2024-09-04", event: "Eye exam", provider: "Dr. Lee", notes: "No retinopathy." },
      { date: "2023-11-22", event: "Specialist visit", provider: "Dr. Patel", notes: "Adjusted lisinopril dose." },
    ]);
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(2000);
  });

  it("renders an IPS narrative PDF from a built bundle", async () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example", birthDate: "1970-01-01" },
      conditions: [{ text: "Type 2 diabetes", icd10: "E11.9" }],
      medications: [{ text: "Metformin", dosage: "500 mg PO BID" }],
    });
    const pdf = await renderIpsNarrativePdf(bundle);
    expect(isPdf(pdf)).toBe(true);
    expect(pdf.length).toBeGreaterThan(1500);
  });
});

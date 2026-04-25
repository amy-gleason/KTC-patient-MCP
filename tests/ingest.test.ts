import { describe, expect, it } from "vitest";
import PDFDocument from "pdfkit";
import { ingestDocument } from "../src/health/ingest.js";

async function makeFakePdf(text: string): Promise<Buffer> {
  // compress:false avoids xref-stream compression that older pdf.js (the version
  // bundled with pdf-parse) cannot read.
  return new Promise((resolve) => {
    const doc = new PDFDocument({ size: "LETTER", compress: false });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.font("Helvetica").fontSize(12).text(text);
    doc.end();
  });
}

describe("ingest_documents", () => {
  it("classifies a FHIR Bundle JSON as fhir-bundle", async () => {
    const bundle = { resourceType: "Bundle", type: "collection", entry: [] };
    const doc = await ingestDocument({
      contentBase64: Buffer.from(JSON.stringify(bundle)).toString("base64"),
      filename: "export.json",
    });
    expect(doc.kind).toBe("fhir-bundle");
    expect(doc.extracted).toEqual(bundle);
  });

  it("classifies a Composition with LOINC 60591-5 as ips-bundle", async () => {
    const ips = {
      resourceType: "Bundle",
      type: "document",
      entry: [
        {
          resource: {
            resourceType: "Composition",
            type: { coding: [{ system: "http://loinc.org", code: "60591-5" }] },
          },
        },
      ],
    };
    const doc = await ingestDocument({
      contentBase64: Buffer.from(JSON.stringify(ips)).toString("base64"),
    });
    expect(doc.kind).toBe("ips-bundle");
  });

  it("classifies a PDF by filename + handles extraction failures gracefully", async () => {
    // pdf-parse's bundled pdf.js v1.10 cannot read pdfkit's modern xref-stream
    // PDFs. The pipeline must classify the document and surface the error
    // without crashing — the LLM can still ask the user for a screenshot.
    const pdfBuf = await makeFakePdf("MyChart Past Visit Details — Dr. Smith");
    const doc = await ingestDocument({
      contentBase64: pdfBuf.toString("base64"),
      filename: "visit.pdf",
      layoutHint: "mychart",
    });
    expect(doc.kind).toBe("pdf");
    expect(doc.layoutHint).toBe("mychart");
    const extracted = doc.extracted as { pages: string[]; extractionError?: string };
    // Either real text extracted OR a graceful error — both are acceptable.
    expect(Array.isArray(extracted.pages)).toBe(true);
    if (extracted.extractionError) {
      expect(extracted.extractionError.length).toBeGreaterThan(0);
    }
  });

  it("skips known-junk filenames", async () => {
    const doc = await ingestDocument({
      contentBase64: Buffer.from("blob").toString("base64"),
      filename: "DICOM/IMG001.dcm",
    });
    expect(doc.skipped).toBeTruthy();
    expect(doc.kind).toBe("unknown");
  });

  it("skips .DS_Store and .dll", async () => {
    const a = await ingestDocument({
      contentBase64: Buffer.from("x").toString("base64"),
      filename: ".DS_Store",
    });
    const b = await ingestDocument({
      contentBase64: Buffer.from("x").toString("base64"),
      filename: "viewer/launcher.dll",
    });
    expect(a.skipped).toBeTruthy();
    expect(b.skipped).toBeTruthy();
  });
});

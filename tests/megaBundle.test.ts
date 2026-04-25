import { describe, expect, it } from "vitest";
import { buildIpsBundle } from "../src/health/ips.js";
import { buildMegaBundle } from "../src/health/megaBundle.js";

describe("build_mega_bundle", () => {
  it("combines IPS + inline + archive + insurance Coverage", () => {
    const ips = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
      conditions: [{ text: "T2DM" }],
    });
    const mega = buildMegaBundle({
      ipsBundle: ips,
      inlineDocuments: [
        {
          title: "Clinical Summary",
          contentBase64: Buffer.from("%PDF-1.4 fake").toString("base64"),
          contentType: "application/pdf",
        },
      ],
      archiveDocuments: [
        { title: "Old labs 2018", url: "https://files.example.org/labs-2018.pdf" },
      ],
      insuranceCards: [
        {
          payerName: "BCBS",
          memberName: "Pat Example",
          memberId: "X123",
          rxBin: "610014",
        },
      ],
    });

    const types = mega.entry.map(
      (e) => (e.resource as { resourceType: string }).resourceType,
    );
    // IPS resources passed through:
    expect(types).toContain("Composition");
    expect(types).toContain("Patient");
    // Coverage added (medical + pharmacy when rxBin given):
    const coverageCount = types.filter((t) => t === "Coverage").length;
    expect(coverageCount).toBe(2);
    // DocumentReferences added:
    expect(types.filter((t) => t === "DocumentReference").length).toBeGreaterThanOrEqual(2);
  });

  it("strips inline base64 from existing DocumentReferences in the IPS bundle", () => {
    // Manually inject a DocumentReference with inline data into an IPS bundle.
    const ips = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
    });
    ips.entry.push({
      fullUrl: "urn:uuid:doc1",
      resource: {
        resourceType: "DocumentReference",
        status: "current",
        content: [
          {
            attachment: {
              contentType: "application/pdf",
              data: "BASE64_BLOB_HERE",
              url: "https://files.example.org/old.pdf",
            },
          },
        ],
      },
    });
    const mega = buildMegaBundle({ ipsBundle: ips });
    const docRef = mega.entry.find(
      (e) => e.fullUrl === "urn:uuid:doc1",
    )?.resource as { content: { attachment: { data?: string; url?: string } }[] };
    expect(docRef.content[0].attachment.data).toBeUndefined();
    expect(docRef.content[0].attachment.url).toBe("https://files.example.org/old.pdf");
  });

  it("prefixes inline document titles with '1 — ', '2 — ' for viewer sort", () => {
    const ips = buildIpsBundle({ patient: { givenName: "Pat", familyName: "Example" } });
    const mega = buildMegaBundle({
      ipsBundle: ips,
      inlineDocuments: [
        { title: "Clinical Summary", contentBase64: "QQ==" },
        { title: "Timeline", contentBase64: "QQ==" },
      ],
    });
    const inlineDocs = mega.entry.filter(
      (e) =>
        (e.resource as { resourceType?: string; description?: string }).resourceType ===
          "DocumentReference" &&
        ((e.resource as { description?: string }).description ?? "").match(/^\d+ — /),
    );
    expect(inlineDocs).toHaveLength(2);
    const descs = inlineDocs.map(
      (e) => (e.resource as { description: string }).description,
    );
    expect(descs).toContain("1 — Clinical Summary");
    expect(descs).toContain("2 — Timeline");
  });
});

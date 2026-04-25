import { describe, expect, it } from "vitest";
import { buildCoverageResources } from "../src/health/insurance.js";
import { renderInsuranceCardPdf } from "../src/health/render.js";

describe("insurance Coverage", () => {
  it("emits payer Organization + medical Coverage", () => {
    const entries = buildCoverageResources(
      {
        payerName: "Blue Cross Blue Shield",
        planName: "Federal Employee Plan Standard",
        memberName: "Pat Example",
        memberId: "ABC123456789",
        groupNumber: "FEP01",
        order: "primary",
        effectiveDate: "2025-01-01",
      },
      "urn:uuid:patient-1",
    );
    expect(entries).toHaveLength(2);
    const [payer, medical] = entries;
    expect((payer.resource as { resourceType: string }).resourceType).toBe("Organization");
    expect((medical.resource as { resourceType: string }).resourceType).toBe("Coverage");
    const cov = medical.resource as {
      subscriberId: string;
      order: number;
      class: { value: string }[];
    };
    expect(cov.subscriberId).toBe("ABC123456789");
    expect(cov.order).toBe(1);
    expect(cov.class.map((c) => c.value)).toEqual(
      expect.arrayContaining(["Federal Employee Plan Standard", "FEP01"]),
    );
  });

  it("adds a separate pharmacy Coverage when RxBIN/RxPCN/RxGroup present", () => {
    const entries = buildCoverageResources(
      {
        payerName: "BCBS",
        memberName: "Pat",
        memberId: "X",
        rxBin: "610014",
        rxPcn: "MEDDPRIME",
        rxGroup: "BCBSFEP",
      },
      "urn:uuid:p",
    );
    // payer + medical + pharmacy
    expect(entries).toHaveLength(3);
    const pharmacyType = (
      entries[2].resource as { type: { coding: { code: string }[] } }
    ).type.coding[0].code;
    expect(pharmacyType).toBe("PHARM");
  });
});

describe("render_insurance_card_pdf", () => {
  it("produces a non-empty PDF buffer with PDF magic", async () => {
    const pdf = await renderInsuranceCardPdf({
      payerName: "Blue Cross Blue Shield",
      planName: "FEP Standard",
      memberName: "Pat Example",
      memberId: "ABC123456789",
      groupNumber: "FEP01",
      rxBin: "610014",
      rxPcn: "MEDDPRIME",
      rxGroup: "BCBSFEP",
      customerServicePhone: "1-800-555-1212",
      copay: "PCP $20 / Specialist $40 / ER $250",
      effectiveDate: "2025-01-01",
    });
    expect(pdf.length).toBeGreaterThan(1000);
    expect(pdf.slice(0, 5).toString("ascii")).toBe("%PDF-");
  });
});

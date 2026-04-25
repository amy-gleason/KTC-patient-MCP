import { describe, expect, it } from "vitest";
import { buildIpsBundle } from "../src/health/ips.js";

describe("build_ips_bundle", () => {
  it("emits a Composition with LOINC 60591-5 + required sections", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example", birthDate: "1970-01-01" },
      conditions: [{ text: "Type 2 diabetes mellitus", icd10: "E11.9" }],
      medications: [{ text: "Metformin", dosage: "500 mg PO BID", rxnorm: "860975" }],
    });
    expect(bundle.type).toBe("document");
    const composition = bundle.entry[0].resource as {
      resourceType: string;
      type: { coding: { code: string }[] };
      section: { title: string }[];
    };
    expect(composition.resourceType).toBe("Composition");
    expect(composition.type.coding[0].code).toBe("60591-5");
    const titles = composition.section.map((s) => s.title);
    expect(titles).toContain("Allergies and Intolerances");
    expect(titles).toContain("Medication Summary");
    expect(titles).toContain("Problem List");
  });

  it("inserts 'no known allergy' SNOMED 716186003 when allergies are absent", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
    });
    const allergy = bundle.entry.find(
      (e) => (e.resource as { resourceType?: string }).resourceType === "AllergyIntolerance",
    )?.resource as { code?: { coding?: { code?: string }[] } };
    expect(allergy.code?.coding?.[0].code).toBe("716186003");
  });

  it("dedupes medications by canonical synonym", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
      medications: [
        { text: "Elavil", dosage: "25 mg PO QHS" },
        { text: "amitriptyline 25mg", dosage: "25 mg" },
      ],
    });
    const meds = bundle.entry.filter(
      (e) => (e.resource as { resourceType?: string }).resourceType === "MedicationStatement",
    );
    expect(meds.length).toBe(1);
  });

  it("drops thin immunization sections (only 1 entry) per handoff guidance", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
      immunizations: [{ text: "Hepatitis B", cvx: "08", date: "1970-01-02" }],
    });
    const composition = bundle.entry[0].resource as { section: { title: string }[] };
    const titles = composition.section.map((s) => s.title);
    expect(titles).not.toContain("Immunizations");
  });

  it("keeps immunizations when 2+ entries", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
      immunizations: [
        { text: "Hepatitis B", cvx: "08" },
        { text: "Influenza", cvx: "88", date: "2024-10-01" },
      ],
    });
    const composition = bundle.entry[0].resource as { section: { title: string }[] };
    expect(composition.section.map((s) => s.title)).toContain("Immunizations");
  });

  it("marks Composition.author as Patient when patient-authored", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
    });
    const comp = bundle.entry[0].resource as { author: { display: string }[] };
    expect(comp.author[0].display).toContain("patient-authored");
  });

  it("drops CareSync junk Conditions with text='Active' and no SNOMED", () => {
    const bundle = buildIpsBundle({
      patient: { givenName: "Pat", familyName: "Example" },
      conditions: [
        { text: "Active" }, // junk
        { text: "Hypertension", icd10: "I10" },
      ],
    });
    const conds = bundle.entry.filter(
      (e) => (e.resource as { resourceType?: string }).resourceType === "Condition",
    );
    expect(conds.length).toBe(1);
  });
});

/**
 * Minimal mock FHIR R4 Bundle resembling an International Patient Summary (IPS).
 * Do not use for real patient data.
 */
export const MOCK_IPS_BUNDLE = {
  resourceType: "Bundle",
  id: "mock-ips-bundle-001",
  type: "document",
  timestamp: "2025-01-02T10:00:00Z",
  entry: [
    {
      fullUrl: "urn:uuid:composition-1",
      resource: {
        resourceType: "Composition",
        id: "composition-1",
        status: "final",
        type: {
          coding: [
            {
              system: "http://loinc.org",
              code: "60591-5",
              display: "Patient Summary",
            },
          ],
        },
        subject: { reference: "urn:uuid:patient-1" },
        date: "2025-01-02T10:00:00Z",
        title: "Patient Summary (IPS)",
        section: [
          { title: "Medications", entry: [{ reference: "urn:uuid:medstmt-1" }] },
          { title: "Problems", entry: [{ reference: "urn:uuid:condition-1" }] },
        ],
      },
    },
    {
      fullUrl: "urn:uuid:patient-1",
      resource: {
        resourceType: "Patient",
        id: "patient-1",
        name: [{ family: "Example", given: ["Pat"] }],
        gender: "unknown",
        birthDate: "1970-01-01",
      },
    },
    {
      fullUrl: "urn:uuid:medstmt-1",
      resource: {
        resourceType: "MedicationStatement",
        id: "medstmt-1",
        status: "active",
        medicationCodeableConcept: {
          coding: [
            {
              system: "http://www.nlm.nih.gov/research/umls/rxnorm",
              code: "860975",
              display: "Metformin 500 MG Oral Tablet",
            },
          ],
        },
        subject: { reference: "urn:uuid:patient-1" },
      },
    },
    {
      fullUrl: "urn:uuid:condition-1",
      resource: {
        resourceType: "Condition",
        id: "condition-1",
        clinicalStatus: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/condition-clinical",
              code: "active",
            },
          ],
        },
        code: {
          coding: [
            {
              system: "http://hl7.org/fhir/sid/icd-10",
              code: "E11.9",
              display: "Type 2 diabetes mellitus without complications",
            },
          ],
        },
        subject: { reference: "urn:uuid:patient-1" },
      },
    },
  ],
} as const;

export const MOCK_MEDICATION_LIST = {
  resourceType: "Bundle",
  id: "mock-meds-001",
  type: "collection",
  entry: [
    {
      resource: {
        resourceType: "MedicationStatement",
        status: "active",
        medicationCodeableConcept: {
          text: "Metformin 500 mg PO BID",
        },
      },
    },
    {
      resource: {
        resourceType: "MedicationStatement",
        status: "active",
        medicationCodeableConcept: {
          text: "Lisinopril 10 mg PO daily",
        },
      },
    },
  ],
} as const;

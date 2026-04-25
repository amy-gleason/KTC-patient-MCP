import { randomUUID } from "node:crypto";
import type { FhirBundleEntry } from "./ips.js";

/**
 * Structured insurance card. Maps to a FHIR Coverage resource (medical) plus
 * an optional pharmacy Coverage when RxBIN/RxPCN/RxGroup are provided.
 */
export interface InsuranceCardInput {
  payerName: string;
  planName?: string;
  memberName: string;
  memberId: string;
  groupNumber?: string;
  /** "primary" | "secondary" | "tertiary". Defaults to primary. */
  order?: "primary" | "secondary" | "tertiary";
  effectiveDate?: string; // YYYY-MM-DD
  expirationDate?: string; // YYYY-MM-DD
  /** Pharmacy benefit fields — separate Coverage resource if provided. */
  rxBin?: string;
  rxPcn?: string;
  rxGroup?: string;
  /** Free-text copay info ("PCP $20 / Specialist $40 / ER $250"). */
  copay?: string;
  /** Customer-service phone (back-of-card). */
  customerServicePhone?: string;
  /** Provider-line phone (back-of-card). */
  providerPhone?: string;
  /** Dependents covered under this card. */
  dependents?: { name: string; relationship?: string; dateOfBirth?: string }[];
  /** Issuer / claims address. */
  claimsAddress?: string;
}

const ORDER_MAP: Record<string, number> = { primary: 1, secondary: 2, tertiary: 3 };

function urn(): string {
  return `urn:uuid:${randomUUID()}`;
}

/**
 * Build FHIR Coverage resource(s) from a structured insurance card.
 * Returns 1 or 2 entries (medical + optional pharmacy).
 */
export function buildCoverageResources(
  card: InsuranceCardInput,
  patientRef: string,
): FhirBundleEntry[] {
  const order = ORDER_MAP[card.order ?? "primary"];

  // Payer Organization
  const payerUrn = urn();
  const payer: FhirBundleEntry = {
    fullUrl: payerUrn,
    resource: {
      resourceType: "Organization",
      name: card.payerName,
    },
  };

  const beneficiaries: { reference: string }[] = [{ reference: patientRef }];
  // Dependents would normally have their own Patient resources; simplified here.

  const medical: FhirBundleEntry = {
    fullUrl: urn(),
    resource: {
      resourceType: "Coverage",
      status: "active",
      type: {
        coding: [
          {
            system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
            code: "HIP",
            display: "health insurance plan policy",
          },
        ],
      },
      subscriber: { reference: patientRef, display: card.memberName },
      subscriberId: card.memberId,
      beneficiary: { reference: patientRef },
      payor: [{ reference: payerUrn, display: card.payerName }],
      class: [
        ...(card.planName
          ? [
              {
                type: {
                  coding: [
                    {
                      system: "http://terminology.hl7.org/CodeSystem/coverage-class",
                      code: "plan",
                    },
                  ],
                },
                value: card.planName,
              },
            ]
          : []),
        ...(card.groupNumber
          ? [
              {
                type: {
                  coding: [
                    {
                      system: "http://terminology.hl7.org/CodeSystem/coverage-class",
                      code: "group",
                    },
                  ],
                },
                value: card.groupNumber,
              },
            ]
          : []),
      ],
      order,
      period: {
        start: card.effectiveDate,
        end: card.expirationDate,
      },
    },
  };

  const out: FhirBundleEntry[] = [payer, medical];

  if (card.rxBin || card.rxPcn || card.rxGroup) {
    const pharmacy: FhirBundleEntry = {
      fullUrl: urn(),
      resource: {
        resourceType: "Coverage",
        status: "active",
        type: {
          coding: [
            {
              system: "http://terminology.hl7.org/CodeSystem/v3-ActCode",
              code: "PHARM",
              display: "pharmacy benefits",
            },
          ],
        },
        subscriber: { reference: patientRef, display: card.memberName },
        subscriberId: card.memberId,
        beneficiary: { reference: patientRef },
        payor: [{ reference: payerUrn, display: card.payerName }],
        class: [
          ...(card.rxBin
            ? [{ type: { text: "RxBIN" }, value: card.rxBin }]
            : []),
          ...(card.rxPcn
            ? [{ type: { text: "RxPCN" }, value: card.rxPcn }]
            : []),
          ...(card.rxGroup
            ? [{ type: { text: "RxGroup" }, value: card.rxGroup }]
            : []),
        ],
        order,
      },
    };
    out.push(pharmacy);
  }

  return out;
}

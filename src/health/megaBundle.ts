import { randomUUID } from "node:crypto";
import type { FhirBundle, FhirBundleEntry } from "./ips.js";
import { buildCoverageResources, type InsuranceCardInput } from "./insurance.js";

export interface InlineDocInput {
  /** Display title; will be prefixed "1 — ", "2 — " etc. so it sorts to top of viewer lists. */
  title: string;
  /** Base64-encoded PDF (or other) content. */
  contentBase64: string;
  contentType?: string;
  date?: string;
}

export interface ArchiveDocInput {
  title: string;
  url: string;
  contentType?: string;
  date?: string;
}

export interface BuildMegaBundleInput {
  ipsBundle: FhirBundle;
  inlineDocuments?: InlineDocInput[];
  archiveDocuments?: ArchiveDocInput[];
  insuranceCards?: InsuranceCardInput[];
}

function urn(): string {
  return `urn:uuid:${randomUUID()}`;
}

function findPatientRef(bundle: FhirBundle): string {
  const entry = bundle.entry.find(
    (e) => (e.resource as { resourceType?: string }).resourceType === "Patient",
  );
  if (!entry) throw new Error("IPS bundle is missing a Patient resource");
  return entry.fullUrl;
}

function makeInlineDocRef(d: InlineDocInput, idx: number, patientRef: string): FhirBundleEntry {
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "DocumentReference",
      status: "current",
      description: `${idx + 1} — ${d.title}`,
      subject: { reference: patientRef },
      date: d.date,
      content: [
        {
          attachment: {
            contentType: d.contentType ?? "application/pdf",
            data: d.contentBase64,
            title: d.title,
          },
        },
      ],
    },
  };
}

function makeArchiveDocRef(d: ArchiveDocInput, patientRef: string): FhirBundleEntry {
  return {
    fullUrl: urn(),
    resource: {
      resourceType: "DocumentReference",
      status: "current",
      description: d.title,
      subject: { reference: patientRef },
      date: d.date,
      content: [
        {
          attachment: {
            contentType: d.contentType ?? "application/pdf",
            url: d.url,
            title: d.title,
          },
        },
      ],
    },
  };
}

/**
 * Build the "mega bundle" combining the IPS + priority inline docs + archive
 * URL-refs + (optional) insurance Coverage resources. Per the handoff:
 * - Strip inline base64 attachments from any DocumentReference already in the
 *   IPS bundle to avoid bloat.
 * - Tag inline docs with "N — " prefix so viewers sort them to the top.
 * - Don't dedupe Observations across sources.
 */
export function buildMegaBundle(input: BuildMegaBundleInput): FhirBundle {
  const patientRef = findPatientRef(input.ipsBundle);

  // Clone + strip inline data from existing DocumentReferences.
  const stripped: FhirBundleEntry[] = input.ipsBundle.entry.map((entry) => {
    if ((entry.resource as { resourceType?: string }).resourceType !== "DocumentReference") {
      return entry;
    }
    const cloned = JSON.parse(JSON.stringify(entry)) as FhirBundleEntry;
    const content = (cloned.resource as { content?: { attachment?: { data?: string } }[] }).content;
    if (Array.isArray(content)) {
      for (const c of content) {
        if (c.attachment && c.attachment.data) {
          delete c.attachment.data;
        }
      }
    }
    return cloned;
  });

  const inline = (input.inlineDocuments ?? []).map((d, i) => makeInlineDocRef(d, i, patientRef));
  const archive = (input.archiveDocuments ?? []).map((d) => makeArchiveDocRef(d, patientRef));

  const coverageEntries: FhirBundleEntry[] = [];
  for (const card of input.insuranceCards ?? []) {
    coverageEntries.push(...buildCoverageResources(card, patientRef));
  }

  return {
    resourceType: "Bundle",
    id: randomUUID(),
    type: "document",
    timestamp: new Date().toISOString(),
    entry: [...stripped, ...coverageEntries, ...inline, ...archive],
  };
}

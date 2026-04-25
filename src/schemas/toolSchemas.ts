import { z } from "zod";

export const ResourceTypeSchema = z.enum([
  "fhir-bundle",
  "ips",
  "medication-list",
  "visit-summary",
  "insurance-card",
]);

export const ViewerSchema = z
  .union([
    z.literal("commonhealth"),
    z.literal("vaxx"),
    z.literal("none"),
    z.string().url().describe("Custom viewer URL (must use https)."),
  ])
  .describe(
    "SHL viewer to wrap the URI in. 'commonhealth' → https://viewer.commonhealth.org/, 'vaxx' → https://demo.vaxx.link/viewer, 'none' → emit raw shlink:/ URI only, or a custom https URL.",
  );

export const CreateSmartHealthLinkInput = z
  .object({
    resourceType: ResourceTypeSchema.describe(
      "Type of health resource being shared.",
    ),
    label: z
      .string()
      .min(1)
      .max(80)
      .describe("Short human-readable label for the link (no PHI).")
      .default("Shared Health Record"),
    /**
     * Either payload or bundleReference must be provided.
     * - payload: inline JSON (FHIR Bundle, insurance card object, etc.)
     * - bundleReference: an external URL; server stores only the reference, not raw data.
     */
    payload: z
      .unknown()
      .optional()
      .describe("Inline FHIR resource or JSON payload to share. Will be encrypted at rest."),
    bundleReference: z
      .string()
      .url()
      .optional()
      .describe("External URL to a FHIR Bundle. Use this to avoid storing raw data on this server."),
    expiresInSeconds: z
      .number()
      .int()
      .positive()
      .optional()
      .describe("Link lifetime in seconds. Defaults to server default (short-lived)."),
    passcode: z
      .string()
      .min(4)
      .max(64)
      .optional()
      .describe("Optional passcode required to resolve the link. Stored only as a scrypt hash."),
    longTerm: z
      .boolean()
      .optional()
      .describe("If true, sets the SHL L-flag (long-term link)."),
    singleUse: z
      .boolean()
      .optional()
      .describe("If true, sets the SHL U-flag (single-use direct-file mode). Defaults to true — recommended for static-friendly hosting per the SHL handoff spec."),
    viewer: ViewerSchema.optional().describe(
      "Optional viewer to wrap the SHL URI in for phone-camera scanning. Defaults to 'commonhealth'.",
    ),
  })
  .refine((v) => v.payload !== undefined || v.bundleReference !== undefined, {
    message: "Either 'payload' or 'bundleReference' is required.",
  });

export type CreateSmartHealthLinkInputT = z.infer<typeof CreateSmartHealthLinkInput>;

export const QrStyleSchema = z
  .enum(["raw", "viewer_wrapped", "universal"])
  .describe(
    "QR style. 'raw' encodes shlink:/ directly (SHL-native scanners only). 'viewer_wrapped' encodes a viewer URL with the shlink in the fragment (phone cameras only). 'universal' encodes the viewer URL — works for both phone cameras and SHL-native scanners that regex out the shlink. Default: 'universal'.",
  );

export const RenderQrCodeInput = z.object({
  link: z
    .string()
    .min(1)
    .describe(
      "A SMART Health Link URL, shlink:/ URI, or viewer-wrapped URL. The tool will detect the format and apply the requested style.",
    ),
  style: QrStyleSchema.default("universal"),
  viewer: ViewerSchema.optional().describe(
    "Viewer to wrap the SHL with when style=viewer_wrapped or universal. Defaults to 'commonhealth'.",
  ),
  size: z
    .number()
    .int()
    .min(128)
    .max(2048)
    .default(512)
    .describe("Pixel width/height of the PNG output. Print-quality default ~512px."),
  margin: z.number().int().min(0).max(16).default(2),
  errorCorrection: z
    .enum(["L", "M", "Q", "H"])
    .default("M")
    .describe("QR error correction level. M is the SHL handoff spec default."),
  includeDataUrl: z
    .boolean()
    .default(true)
    .describe("If true, returns PNG as a data URL suitable for embedding in chat UIs."),
});

export type RenderQrCodeInputT = z.infer<typeof RenderQrCodeInput>;

export const RevokeSmartHealthLinkInput = z.object({
  id: z.string().min(1).describe("The link ID returned from create_smart_health_link."),
  reason: z.string().max(200).optional().describe("Optional reason for revocation (no PHI)."),
});

export type RevokeSmartHealthLinkInputT = z.infer<typeof RevokeSmartHealthLinkInput>;

export const GetSmartHealthLinkStatusInput = z.object({
  id: z.string().min(1).describe("The link ID returned from create_smart_health_link."),
});

export type GetSmartHealthLinkStatusInputT = z.infer<typeof GetSmartHealthLinkStatusInput>;

// ============================================================================
// Health pipeline tools (build_ips, render_*, build_mega, ingest, extract,
// render_insurance_card)
// ============================================================================

export const IngestDocumentsInput = z.object({
  files: z
    .array(
      z.object({
        contentBase64: z.string().min(1),
        filename: z.string().optional(),
        contentType: z.string().optional(),
        jweKey: z.string().optional().describe("43-char base64url key for SHL JWE inputs"),
        layoutHint: z
          .enum([
            "caresync",
            "mychart",
            "ciox",
            "discharge-summary",
            "operative-report",
            "lab-report",
            "imaging-read",
            "ros-pdf",
            "generic",
          ])
          .optional(),
      }),
    )
    .min(1)
    .describe("One or more documents to classify and parse. Use ingest_documents before extract_fhir."),
});

export const ExtractFhirInput = z.object({
  documentId: z.string().min(1).describe("ID returned from ingest_documents."),
});

const PatientSchema = z.object({
  givenName: z.string().min(1),
  familyName: z.string().min(1),
  birthDate: z.string().optional(),
  gender: z.enum(["male", "female", "other", "unknown"]).optional(),
});

export const BuildIpsBundleInput = z.object({
  patient: PatientSchema,
  custodianOrganization: z.object({ name: z.string() }).optional(),
  conditions: z
    .array(
      z.object({
        text: z.string(),
        snomed: z.string().optional(),
        icd10: z.string().optional(),
        clinicalStatus: z
          .enum(["active", "recurrence", "relapse", "inactive", "remission", "resolved"])
          .optional(),
        onsetDate: z.string().optional(),
        recordedDate: z.string().optional(),
      }),
    )
    .optional(),
  medications: z
    .array(
      z.object({
        text: z.string(),
        rxnorm: z.string().optional(),
        status: z.enum(["active", "completed", "stopped", "intended", "on-hold"]).optional(),
        dosage: z.string().optional(),
        asserter: z.enum(["patient", "clinician"]).optional(),
      }),
    )
    .optional(),
  allergies: z
    .array(
      z.object({
        text: z.string(),
        snomed: z.string().optional(),
        severity: z.enum(["mild", "moderate", "severe"]).optional(),
        reaction: z.string().optional(),
      }),
    )
    .optional(),
  procedures: z
    .array(
      z.object({
        text: z.string(),
        snomed: z.string().optional(),
        cpt: z.string().optional(),
        performedDate: z.string().optional(),
      }),
    )
    .optional(),
  observations: z
    .array(
      z.object({
        text: z.string(),
        loinc: z.string().optional(),
        value: z.union([z.string(), z.number()]).optional(),
        unit: z.string().optional(),
        effectiveDate: z.string().optional(),
      }),
    )
    .optional(),
  immunizations: z
    .array(
      z.object({
        text: z.string(),
        cvx: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .optional(),
  dedupe: z.boolean().optional(),
  pruneEmpty: z.boolean().optional(),
  skipSections: z.array(z.enum(["immunizations", "procedures", "results"])).optional(),
  patientAuthored: z.boolean().optional(),
});

export const RenderClinicalSummaryPdfInput = z.object({
  patientName: z.string().min(1),
  patientDob: z.string().optional(),
  oneLiner: z.string().min(1).describe("Single-sentence patient pitch."),
  history: z.array(z.string()).default([]).describe("History paragraphs."),
  currentRegimen: z
    .array(
      z.object({
        medication: z.string(),
        dose: z.string().optional(),
        indication: z.string().optional(),
      }),
    )
    .default([]),
  priorTherapies: z.string().optional(),
  activeIssues: z.array(z.string()).default([]),
  assessment: z.string().min(1),
  audience: z.enum(["oncologist", "pcp", "er", "general"]).optional(),
  authorNote: z.string().optional(),
});

export const RenderTimelinePdfInput = z.object({
  patientName: z.string().min(1),
  entries: z
    .array(
      z.object({
        date: z.string().describe("ISO YYYY-MM-DD"),
        event: z.string(),
        notes: z.string().optional(),
        provider: z.string().optional(),
        facility: z.string().optional(),
      }),
    )
    .min(1),
});

export const RenderIpsNarrativePdfInput = z.object({
  bundle: z.unknown().describe("FHIR IPS Bundle (JSON object)"),
});

const InsuranceCardSchema = z.object({
  payerName: z.string().min(1),
  planName: z.string().optional(),
  memberName: z.string().min(1),
  memberId: z.string().min(1),
  groupNumber: z.string().optional(),
  order: z.enum(["primary", "secondary", "tertiary"]).optional(),
  effectiveDate: z.string().optional(),
  expirationDate: z.string().optional(),
  rxBin: z.string().optional(),
  rxPcn: z.string().optional(),
  rxGroup: z.string().optional(),
  copay: z.string().optional(),
  customerServicePhone: z.string().optional(),
  providerPhone: z.string().optional(),
  dependents: z
    .array(
      z.object({
        name: z.string(),
        relationship: z.string().optional(),
        dateOfBirth: z.string().optional(),
      }),
    )
    .optional(),
  claimsAddress: z.string().optional(),
});

export const RenderInsuranceCardPdfInput = InsuranceCardSchema;

export const BuildMegaBundleInput = z.object({
  ipsBundle: z.unknown().describe("FHIR IPS Bundle (JSON object) returned from build_ips_bundle."),
  inlineDocuments: z
    .array(
      z.object({
        title: z.string(),
        contentBase64: z.string(),
        contentType: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .optional()
    .describe("Priority tier — inlined as DocumentReference.attachment.data."),
  archiveDocuments: z
    .array(
      z.object({
        title: z.string(),
        url: z.string().url(),
        contentType: z.string().optional(),
        date: z.string().optional(),
      }),
    )
    .optional()
    .describe("Archive tier — referenced by URL only (no PHI stored on this server)."),
  insuranceCards: z.array(InsuranceCardSchema).optional(),
});

export type IngestDocumentsInputT = z.infer<typeof IngestDocumentsInput>;
export type ExtractFhirInputT = z.infer<typeof ExtractFhirInput>;
export type BuildIpsBundleInputT = z.infer<typeof BuildIpsBundleInput>;
export type RenderClinicalSummaryPdfInputT = z.infer<typeof RenderClinicalSummaryPdfInput>;
export type RenderTimelinePdfInputT = z.infer<typeof RenderTimelinePdfInput>;
export type RenderIpsNarrativePdfInputT = z.infer<typeof RenderIpsNarrativePdfInput>;
export type RenderInsuranceCardPdfInputT = z.infer<typeof RenderInsuranceCardPdfInput>;
export type BuildMegaBundleInputT = z.infer<typeof BuildMegaBundleInput>;

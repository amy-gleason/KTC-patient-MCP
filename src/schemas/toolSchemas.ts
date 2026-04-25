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

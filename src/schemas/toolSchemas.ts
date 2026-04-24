import { z } from "zod";

export const ResourceTypeSchema = z.enum([
  "fhir-bundle",
  "ips",
  "medication-list",
  "visit-summary",
  "insurance-card",
]);

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
    singleUse: z
      .boolean()
      .optional()
      .describe("If true, marks the link with the SHL U-flag (single use)."),
  })
  .refine((v) => v.payload !== undefined || v.bundleReference !== undefined, {
    message: "Either 'payload' or 'bundleReference' is required.",
  });

export type CreateSmartHealthLinkInputT = z.infer<typeof CreateSmartHealthLinkInput>;

export const RenderQrCodeInput = z.object({
  link: z
    .string()
    .min(1)
    .describe("A SMART Health Link URL or shlink:/ URI."),
  size: z
    .number()
    .int()
    .min(128)
    .max(2048)
    .default(512)
    .describe("Pixel width/height of the PNG output."),
  margin: z.number().int().min(0).max(16).default(2),
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

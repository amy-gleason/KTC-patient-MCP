import express, { type Express, type Request, type Response } from "express";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { SSEServerTransport } from "@modelcontextprotocol/sdk/server/sse.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";

import { audit } from "./backend/audit.js";
import { decryptJson } from "./backend/crypto.js";
import { encryptJwe } from "./backend/jwe.js";
import { LinkStore } from "./backend/storage.js";
import { verifyPasscode } from "./backend/crypto.js";
import { loadConfig, type AppConfig } from "./config.js";
import {
  BuildIpsBundleInput,
  BuildMegaBundleInput,
  CreateSmartHealthLinkInput,
  ExtractFhirInput,
  GetSmartHealthLinkStatusInput,
  IngestDocumentsInput,
  RenderClinicalSummaryPdfInput,
  RenderInsuranceCardPdfInput,
  RenderIpsNarrativePdfInput,
  RenderQrCodeInput,
  RenderTimelinePdfInput,
  RevokeSmartHealthLinkInput,
} from "./schemas/toolSchemas.js";
import { createSmartHealthLink } from "./tools/createSmartHealthLink.js";
import { getSmartHealthLinkStatus } from "./tools/getSmartHealthLinkStatus.js";
import { renderQrCode } from "./tools/renderQrCode.js";
import { revokeSmartHealthLink } from "./tools/revokeSmartHealthLink.js";
import { buildIpsBundle, type FhirBundle } from "./health/ips.js";
import { buildMegaBundle } from "./health/megaBundle.js";
import {
  extractFhir as extractFhirFn,
  ingestDocument,
  type IngestedDocument,
} from "./health/ingest.js";
import {
  renderClinicalSummaryPdf,
  renderInsuranceCardPdf,
  renderIpsNarrativePdf,
  renderTimelinePdf,
} from "./health/render.js";

export interface ServerBundle {
  app: Express;
  mcp: Server;
  store: LinkStore;
  config: AppConfig;
}

function zodToJsonSchema(schema: z.ZodType): Record<string, unknown> {
  // Minimal subset — just enough for MCP tool advertisement.
  // For production, use zod-to-json-schema.
  const def: Record<string, unknown> = { type: "object" };
  if (schema instanceof z.ZodObject) {
    const shape = (schema as z.ZodObject<z.ZodRawShape>).shape;
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const [k, v] of Object.entries(shape)) {
      properties[k] = describeZod(v as z.ZodType);
      if (!(v as z.ZodType).isOptional()) required.push(k);
    }
    def.properties = properties;
    if (required.length) def.required = required;
  }
  return def;
}

function describeZod(t: z.ZodType): Record<string, unknown> {
  const desc = (t as unknown as { _def: { description?: string } })._def.description;
  const inner = t instanceof z.ZodOptional ? t.unwrap() : t instanceof z.ZodDefault ? t.removeDefault() : t;
  let base: Record<string, unknown> = {};
  if (inner instanceof z.ZodString) base = { type: "string" };
  else if (inner instanceof z.ZodNumber) base = { type: "number" };
  else if (inner instanceof z.ZodBoolean) base = { type: "boolean" };
  else if (inner instanceof z.ZodEnum) base = { type: "string", enum: (inner as z.ZodEnum<[string, ...string[]]>).options };
  else if (inner instanceof z.ZodObject) base = zodToJsonSchema(inner);
  else base = {};
  if (desc) base.description = desc;
  return base;
}

export function buildMcpServer(deps: { store: LinkStore; config: AppConfig }): Server {
  const server = new Server(
    { name: "ktc-patient-mcp", version: "0.1.0" },
    { capabilities: { tools: {} } },
  );

  // Document cache so extract_fhir can refer to a previously ingested document by ID.
  const docCache = new Map<string, IngestedDocument>();

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: [
      // --- SHL share-link layer ---
      {
        name: "create_smart_health_link",
        description:
          "Create a SMART Health Link (shlink:/ URI) for a FHIR Bundle, IPS, medication list, visit summary, or insurance card. Supports expiration, viewer wrapping, and optional passcode.",
        inputSchema: zodToJsonSchema(CreateSmartHealthLinkInput as unknown as z.ZodType),
      },
      {
        name: "render_qr_code",
        description:
          "Render a SMART Health Link URI as a QR code (SVG and PNG). 'universal' style works for phone cameras AND SHL scanners.",
        inputSchema: zodToJsonSchema(RenderQrCodeInput),
      },
      {
        name: "revoke_smart_health_link",
        description: "Revoke a previously generated SMART Health Link by ID.",
        inputSchema: zodToJsonSchema(RevokeSmartHealthLinkInput),
      },
      {
        name: "get_smart_health_link_status",
        description:
          "Return the status of a SMART Health Link (active, expired, revoked) and access metadata.",
        inputSchema: zodToJsonSchema(GetSmartHealthLinkStatusInput),
      },
      // --- Health pipeline ---
      {
        name: "ingest_documents",
        description:
          "Classify and parse one or more uploaded files (FHIR JSON, SHL JWE, PDF, CCDA, plain JSON). Returns document IDs + parsed content (per-page text for PDFs). Use before extract_fhir.",
        inputSchema: zodToJsonSchema(IngestDocumentsInput as unknown as z.ZodType),
      },
      {
        name: "extract_fhir",
        description:
          "Return the parsed content of a previously ingested document with a layout hint and a 'next' suggestion. Designed for LLM-in-the-loop structured extraction (you read the text, you call build_ips_bundle).",
        inputSchema: zodToJsonSchema(ExtractFhirInput),
      },
      {
        name: "build_ips_bundle",
        description:
          "Build a conformant IPS FHIR R4 Bundle from structured patient/conditions/medications/allergies/etc. Handles dedupe, RxNorm/SNOMED/CVX codings, the 'no known allergies' convention, and Composition section assembly (LOINC 60591-5).",
        inputSchema: zodToJsonSchema(BuildIpsBundleInput as unknown as z.ZodType),
      },
      {
        name: "render_clinical_summary_pdf",
        description:
          "Render a Dr-Rider-style ~3-page clinical summary PDF: one-liner, history, current regimen table, prior therapies, active issues, assessment. Returns PDF as base64.",
        inputSchema: zodToJsonSchema(RenderClinicalSummaryPdfInput as unknown as z.ZodType),
      },
      {
        name: "render_timeline_pdf",
        description:
          "Render a reverse-chronological timeline PDF, grouped by month, 3-column (date | event | notes). Returns PDF as base64.",
        inputSchema: zodToJsonSchema(RenderTimelinePdfInput as unknown as z.ZodType),
      },
      {
        name: "render_ips_narrative_pdf",
        description:
          "Render an IPS Bundle's Composition into a single-column narrative PDF (one section per heading). Returns PDF as base64.",
        inputSchema: zodToJsonSchema(RenderIpsNarrativePdfInput),
      },
      {
        name: "render_insurance_card_pdf",
        description:
          "Render a wallet-card-style insurance card PDF (front + back). Returns PDF as base64.",
        inputSchema: zodToJsonSchema(RenderInsuranceCardPdfInput as unknown as z.ZodType),
      },
      {
        name: "build_mega_bundle",
        description:
          "Combine an IPS Bundle with priority inline DocumentReferences (base64 PDFs), archive URL DocumentReferences, and optional insurance Coverage resources. Strips inline base64 from any DocumentReferences already in the IPS bundle to keep size manageable.",
        inputSchema: zodToJsonSchema(BuildMegaBundleInput as unknown as z.ZodType),
      },
    ],
  }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const { name, arguments: args } = req.params;
    try {
      switch (name) {
        case "create_smart_health_link": {
          const result = createSmartHealthLink(args, deps);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "render_qr_code": {
          const result = await renderQrCode(args);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  { link: result.link, svg: result.svg, pngDataUrl: result.pngDataUrl },
                  null,
                  2,
                ),
              },
              ...(result.pngDataUrl
                ? [
                    {
                      type: "image" as const,
                      data: result.pngBase64,
                      mimeType: "image/png",
                    },
                  ]
                : []),
            ],
          };
        }
        case "revoke_smart_health_link": {
          const result = revokeSmartHealthLink(args, deps.store);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "get_smart_health_link_status": {
          const result = getSmartHealthLinkStatus(args, deps.store);
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "ingest_documents": {
          const parsed = IngestDocumentsInput.parse(args);
          const docs = await Promise.all(parsed.files.map((f) => ingestDocument(f)));
          for (const d of docs) docCache.set(d.id, d);
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify(
                  docs.map((d) => ({ ...d, extracted: summarizeExtracted(d.extracted) })),
                  null,
                  2,
                ),
              },
            ],
          };
        }
        case "extract_fhir": {
          const parsed = ExtractFhirInput.parse(args);
          const doc = docCache.get(parsed.documentId);
          if (!doc) {
            return {
              isError: true,
              content: [{ type: "text", text: `Unknown documentId: ${parsed.documentId}` }],
            };
          }
          const result = extractFhirFn({ document: doc });
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        }
        case "build_ips_bundle": {
          const parsed = BuildIpsBundleInput.parse(args);
          const bundle = buildIpsBundle(parsed);
          return { content: [{ type: "text", text: JSON.stringify(bundle, null, 2) }] };
        }
        case "render_clinical_summary_pdf": {
          const parsed = RenderClinicalSummaryPdfInput.parse(args);
          const pdf = await renderClinicalSummaryPdf(parsed);
          return pdfResult(pdf, "clinical-summary.pdf");
        }
        case "render_timeline_pdf": {
          const parsed = RenderTimelinePdfInput.parse(args);
          const pdf = await renderTimelinePdf(parsed.patientName, parsed.entries);
          return pdfResult(pdf, "timeline.pdf");
        }
        case "render_ips_narrative_pdf": {
          const parsed = RenderIpsNarrativePdfInput.parse(args);
          const pdf = await renderIpsNarrativePdf(parsed.bundle as FhirBundle);
          return pdfResult(pdf, "ips-narrative.pdf");
        }
        case "render_insurance_card_pdf": {
          const parsed = RenderInsuranceCardPdfInput.parse(args);
          const pdf = await renderInsuranceCardPdf(parsed);
          return pdfResult(pdf, "insurance-card.pdf");
        }
        case "build_mega_bundle": {
          const parsed = BuildMegaBundleInput.parse(args);
          const bundle = buildMegaBundle({
            ipsBundle: parsed.ipsBundle as FhirBundle,
            inlineDocuments: parsed.inlineDocuments,
            archiveDocuments: parsed.archiveDocuments,
            insuranceCards: parsed.insuranceCards,
          });
          return { content: [{ type: "text", text: JSON.stringify(bundle, null, 2) }] };
        }
        default:
          return {
            isError: true,
            content: [{ type: "text", text: `Unknown tool: ${name}` }],
          };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        isError: true,
        content: [{ type: "text", text: `Error: ${message}` }],
      };
    }
  });

  return server;
}

export function buildApp(deps: { store: LinkStore; config: AppConfig }): ServerBundle {
  const app = express();
  // Trust the upstream proxy (Fly, Render, Cloudflare, Nginx) so that
  // req.protocol reflects the original https scheme.
  app.set("trust proxy", true);
  // 25 MB so ingest_documents can accept multi-PDF base64 uploads (each
  // base64 inflates ~33%). Share-link payloads remain well under this.
  app.use(express.json({ limit: "25mb" }));

  const mcp = buildMcpServer(deps);

  // Health + metadata (no PHI).
  app.get("/healthz", (_req, res) => res.json({ ok: true }));

  // MCP over SSE (remote transport). Each client opens GET /mcp/sse and
  // POSTs messages to /mcp/messages?sessionId=...
  const transports = new Map<string, SSEServerTransport>();

  app.get("/mcp/sse", async (_req, res) => {
    const transport = new SSEServerTransport("/mcp/messages", res);
    transports.set(transport.sessionId, transport);
    res.on("close", () => transports.delete(transport.sessionId));
    await mcp.connect(transport);
  });

  app.post("/mcp/messages", async (req, res) => {
    const sessionId = req.query.sessionId as string | undefined;
    const transport = sessionId ? transports.get(sessionId) : undefined;
    if (!transport) {
      res.status(400).json({ error: "Unknown sessionId" });
      return;
    }
    await transport.handlePostMessage(req, res);
  });

  // SMART Health Link manifest endpoint (SHL v1 spec).
  // POST /shl/manifest/:id  body: { recipient?: string, passcode?: string }
  app.post("/shl/manifest/:id", async (req: Request, res: Response) => {
    await handleManifest(req, res, deps);
  });
  // Convenience GET for dev/testing (no passcode).
  app.get("/shl/manifest/:id", async (req, res) => {
    await handleManifest(req, res, deps);
  });

  // Direct-file mode (SHL "U" flag). Static-host friendly: returns the raw JWE
  // bytes with Content-Type: application/jose + permissive CORS.
  // Per the handoff spec this is preferred for static deployments.
  app.options("/shl/file/:id.jwe", (_req, res) => {
    setJoseCors(res);
    res.status(204).end();
  });
  app.get("/shl/file/:id.jwe", async (req, res) => {
    await handleDirectFile(req, res, deps);
  });

  return { app, mcp, store: deps.store, config: deps.config };
}

function pdfResult(pdf: Buffer, filename: string): { content: { type: "text"; text: string }[] } {
  const base64 = pdf.toString("base64");
  return {
    content: [
      {
        type: "text",
        text: JSON.stringify(
          {
            filename,
            mimeType: "application/pdf",
            sizeBytes: pdf.length,
            base64,
            dataUrl: `data:application/pdf;base64,${base64}`,
          },
          null,
          2,
        ),
      },
    ],
  };
}

/**
 * For ingest_documents results, omit the full per-page text from the LLM-facing
 * payload when it's enormous; keep first 2000 chars per page. Bundle/JSON
 * extracts pass through.
 */
function summarizeExtracted(extracted: unknown): unknown {
  if (extracted && typeof extracted === "object" && Array.isArray((extracted as { pages?: string[] }).pages)) {
    const pages = (extracted as { pages: string[] }).pages;
    return {
      pages: pages.map((p) => (p.length > 2000 ? p.slice(0, 2000) + "\n…[truncated]" : p)),
      truncated: pages.some((p) => p.length > 2000),
    };
  }
  return extracted;
}

function setJoseCors(res: Response): void {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type, Accept");
  res.setHeader("Cache-Control", "public, max-age=300, s-maxage=300");
}

async function handleDirectFile(
  req: Request,
  res: Response,
  deps: { store: LinkStore; config: AppConfig },
): Promise<void> {
  const id = req.params.id;
  const rec = deps.store.get(id);
  if (!rec) {
    audit("link.access_denied", id, { reason: "not-found" });
    setJoseCors(res);
    res.status(404).json({ error: "Link not found" });
    return;
  }
  if (rec.revoked) {
    audit("link.access_denied", id, { reason: "revoked" });
    setJoseCors(res);
    res.status(410).json({ error: "Link revoked" });
    return;
  }
  if (rec.expiresAt <= Math.floor(Date.now() / 1000)) {
    audit("link.access_denied", id, { reason: "expired" });
    setJoseCors(res);
    res.status(410).json({ error: "Link expired" });
    return;
  }

  // Resolve plaintext.
  let plaintextObj: unknown;
  if (rec.ciphertext) {
    plaintextObj = decryptJson(
      { ciphertext: rec.ciphertext, iv: rec.iv, authTag: rec.authTag },
      deps.config.payloadKey,
    );
  } else if (rec.byReference) {
    plaintextObj = { reference: rec.byReference };
  } else {
    res.status(500).json({ error: "Link has no payload or reference" });
    return;
  }

  const keyBytes = Buffer.from(
    rec.encryptionKey.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (rec.encryptionKey.length % 4)) % 4),
    "base64",
  );
  const cty = rec.resourceType === "insurance-card" ? "application/json" : "application/fhir+json";
  // Per handoff: NO `zip: "DEF"` — many viewers fail to decompress.
  const jwe = encryptJwe(Buffer.from(JSON.stringify(plaintextObj), "utf8"), keyBytes, { cty });

  deps.store.recordAccess(id);
  audit("link.accessed", id, { resourceType: rec.resourceType, mode: "direct-file" });

  setJoseCors(res);
  // Send as Buffer + explicit header so Express does not append `; charset=utf-8`.
  // Some scanners validate the Content-Type literally.
  res.setHeader("Content-Type", "application/jose");
  res.end(Buffer.from(jwe, "ascii"));
}

async function handleManifest(
  req: Request,
  res: Response,
  deps: { store: LinkStore; config: AppConfig },
): Promise<void> {
  const id = req.params.id;
  const rec = deps.store.get(id);
  if (!rec) {
    audit("link.access_denied", id, { reason: "not-found" });
    res.status(404).json({ error: "Link not found" });
    return;
  }
  if (rec.revoked) {
    audit("link.access_denied", id, { reason: "revoked" });
    res.status(410).json({ error: "Link revoked" });
    return;
  }
  if (rec.expiresAt <= Math.floor(Date.now() / 1000)) {
    audit("link.access_denied", id, { reason: "expired" });
    res.status(410).json({ error: "Link expired" });
    return;
  }

  if (rec.passcodeHash && rec.passcodeSalt) {
    const passcode =
      (req.body && typeof req.body.passcode === "string" ? req.body.passcode : undefined) ||
      (typeof req.query.passcode === "string" ? req.query.passcode : undefined);
    if (!passcode || !verifyPasscode(passcode, rec.passcodeHash, rec.passcodeSalt)) {
      audit("link.access_denied", id, { reason: "bad-passcode" });
      res.status(401).json({ error: "Passcode required or incorrect" });
      return;
    }
  }

  // Resolve payload: either inline encrypted bundle, or reference to external.
  let plaintextObj: unknown;
  if (rec.ciphertext) {
    plaintextObj = decryptJson(
      { ciphertext: rec.ciphertext, iv: rec.iv, authTag: rec.authTag },
      deps.config.payloadKey,
    );
  } else if (rec.byReference) {
    plaintextObj = { reference: rec.byReference };
  } else {
    res.status(500).json({ error: "Link has no payload or reference" });
    return;
  }

  // Re-encrypt as JWE with the per-link key that the SHL recipient holds.
  const keyBytes = Buffer.from(
    rec.encryptionKey.replace(/-/g, "+").replace(/_/g, "/") +
      "=".repeat((4 - (rec.encryptionKey.length % 4)) % 4),
    "base64",
  );
  const cty = rec.resourceType === "insurance-card" ? "application/json" : "application/fhir+json";
  const jwe = encryptJwe(Buffer.from(JSON.stringify(plaintextObj), "utf8"), keyBytes, { cty });

  deps.store.recordAccess(id);
  audit("link.accessed", id, { resourceType: rec.resourceType });

  res.json({
    files: [
      {
        contentType: cty,
        embedded: jwe,
      },
    ],
  });
}

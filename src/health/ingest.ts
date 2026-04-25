import { randomUUID } from "node:crypto";
import { decryptJwe } from "../backend/jwe.js";
import { base64UrlDecode } from "../backend/crypto.js";
import { gunzipSync, inflateRawSync } from "node:zlib";

/**
 * Ingestion + extraction.
 *
 * Per the handoff spec:
 *   "the ingestion/extraction tools are the ones that benefit from
 *    LLM-in-the-loop"
 * So this module deliberately stops short of trying to be a layout-aware
 * MyChart/Ciox/CareSync parser. It classifies the document, extracts the
 * cleanest representation it can (decoded JSON, decrypted FHIR Bundle, or
 * page-split plain text), and hands back a document handle the LLM can
 * reason over to produce structured ConditionInput[]/MedicationInput[]/etc.
 */

export type DocumentKind =
  | "fhir-bundle"
  | "ips-bundle"
  | "smart-health-card"
  | "shl-jwe"
  | "pdf"
  | "ccda-xml"
  | "json"
  | "unknown";

export type LayoutHint =
  | "caresync"
  | "mychart"
  | "ciox"
  | "discharge-summary"
  | "operative-report"
  | "lab-report"
  | "imaging-read"
  | "ros-pdf"
  | "generic";

export interface IngestedDocument {
  id: string;
  filename?: string;
  kind: DocumentKind;
  layoutHint?: LayoutHint;
  /** Human-summary metadata only — no PHI in this object's keys outside of `extracted`. */
  meta: {
    sizeBytes: number;
    pageCount?: number;
    title?: string;
    detectedAt: string;
  };
  /**
   * For JSON/FHIR/JWE inputs: parsed JSON. For PDFs: array of page text.
   * For CCDA: raw XML string. For unknown: undefined.
   */
  extracted: unknown;
  /** Skip-list reasons for files we recognize but won't use. */
  skipped?: string;
}

export interface IngestInput {
  /** Base64-encoded file content. */
  contentBase64: string;
  filename?: string;
  contentType?: string;
  /** Optional decryption key for SHL JWE inputs (43-char base64url). */
  jweKey?: string;
  /** Hint for downstream extract_fhir. */
  layoutHint?: LayoutHint;
}

const SKIP_EXTENSIONS = new Set([
  ".dll",
  ".exe",
  ".dts",
  ".chm",
  ".bin",
  ".ocx",
  ".ini",
]);
const SKIP_NAMES = new Set(["dicomdir", ".ds_store"]);
const SKIP_DIRS = ["dicom/", "__macosx/"];

function shouldSkip(filename?: string): string | undefined {
  if (!filename) return undefined;
  const lower = filename.toLowerCase();
  for (const dir of SKIP_DIRS) if (lower.startsWith(dir)) return `path under ${dir}`;
  const base = lower.split("/").pop() ?? lower;
  if (SKIP_NAMES.has(base)) return `name in skip list (${base})`;
  const dot = base.lastIndexOf(".");
  if (dot >= 0) {
    const ext = base.slice(dot);
    if (SKIP_EXTENSIONS.has(ext)) return `extension in skip list (${ext})`;
  }
  return undefined;
}

function detectKind(content: Buffer, filename?: string, contentType?: string): DocumentKind {
  const lowerName = filename?.toLowerCase() ?? "";
  const ct = (contentType ?? "").toLowerCase();

  if (ct.includes("application/pdf") || lowerName.endsWith(".pdf")) return "pdf";
  if (lowerName.endsWith(".jwe") || ct.includes("application/jose")) return "shl-jwe";
  if (lowerName.endsWith(".xml") || ct.includes("xml")) return "ccda-xml";

  // Try JSON parse for type hints.
  if (lowerName.endsWith(".json") || ct.includes("json") || content[0] === 0x7b) {
    try {
      const text = content.toString("utf8");
      const obj = JSON.parse(text);
      if (obj?.resourceType === "Bundle") {
        // IPS detection: composition with LOINC 60591-5
        const compositionHasIps = (obj.entry ?? []).some(
          (e: { resource?: { resourceType?: string; type?: { coding?: { code?: string }[] } } }) =>
            e.resource?.resourceType === "Composition" &&
            (e.resource.type?.coding ?? []).some((c) => c.code === "60591-5"),
        );
        return compositionHasIps ? "ips-bundle" : "fhir-bundle";
      }
      if (obj?.verifiableCredential) return "smart-health-card";
      return "json";
    } catch {
      /* fall through */
    }
  }

  // Compact JWE: 5 base64url-safe parts joined by `.`
  const headStr = content.slice(0, Math.min(content.length, 4096)).toString("ascii");
  if (/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/.test(headStr)) {
    return "shl-jwe";
  }

  return "unknown";
}

async function extractPdfText(content: Buffer): Promise<{ pages: string[]; pageCount: number }> {
  // Lazy-import pdf-parse via the inner module path. The package's index.js has
  // a debug clause that tries to load a test fixture at module init when called
  // as the entry point — importing the inner file skips that clause.
  const mod = (await import("pdf-parse/lib/pdf-parse.js")) as {
    default: (b: Buffer, opts?: unknown) => Promise<{ text: string; numpages: number }>;
  };
  const fn = mod.default;
  const result = await fn(content);
  // pdf-parse joins pages with form-feed (\f). Split it back out.
  const pages = result.text.split(/\f/).map((s) => s.trim());
  return { pages, pageCount: result.numpages };
}

function tryDecompress(buf: Buffer): Buffer {
  // Try gzip, then raw-deflate (handoff calls out `zlib.decompress(pt, -15)` in Python = raw inflate).
  try {
    return gunzipSync(buf);
  } catch {
    /* not gzip */
  }
  try {
    return inflateRawSync(buf);
  } catch {
    /* not raw deflate */
  }
  return buf;
}

async function decryptShlJwe(content: Buffer, jweKey?: string): Promise<unknown> {
  if (!jweKey) {
    return { needsKey: true, tokenLength: content.length };
  }
  const keyBytes = base64UrlDecode(jweKey);
  if (keyBytes.length !== 32) {
    throw new Error("SHL JWE key must decode to 32 bytes (base64url-encoded)");
  }
  const token = content.toString("ascii");
  let pt = decryptJwe(token, keyBytes);
  // Per handoff: CareSync-style SHLs DEFLATE-compress the payload (zip:"DEF").
  // We don't emit zip, but we still accept it on input.
  pt = tryDecompress(pt);
  const text = pt.toString("utf8");
  try {
    return JSON.parse(text);
  } catch {
    return { textPreview: text.slice(0, 500), note: "decrypted but not valid JSON" };
  }
}

export async function ingestDocument(input: IngestInput): Promise<IngestedDocument> {
  const content = Buffer.from(input.contentBase64, "base64");
  const id = randomUUID();
  const detectedAt = new Date().toISOString();

  const skipReason = shouldSkip(input.filename);
  if (skipReason) {
    return {
      id,
      filename: input.filename,
      kind: "unknown",
      meta: { sizeBytes: content.length, detectedAt },
      extracted: undefined,
      skipped: skipReason,
    };
  }

  const kind = detectKind(content, input.filename, input.contentType);

  switch (kind) {
    case "fhir-bundle":
    case "ips-bundle":
    case "json":
    case "smart-health-card": {
      const obj = JSON.parse(content.toString("utf8"));
      return {
        id,
        filename: input.filename,
        kind,
        layoutHint: input.layoutHint,
        meta: {
          sizeBytes: content.length,
          detectedAt,
          title:
            obj?.entry?.find?.((e: { resource?: { resourceType?: string; title?: string } }) =>
              e.resource?.resourceType === "Composition",
            )?.resource?.title,
        },
        extracted: obj,
      };
    }
    case "shl-jwe": {
      const extracted = await decryptShlJwe(content, input.jweKey);
      return {
        id,
        filename: input.filename,
        kind,
        layoutHint: input.layoutHint,
        meta: { sizeBytes: content.length, detectedAt },
        extracted,
      };
    }
    case "pdf": {
      try {
        const { pages, pageCount } = await extractPdfText(content);
        return {
          id,
          filename: input.filename,
          kind,
          layoutHint: input.layoutHint ?? guessPdfLayout(pages.join("\n").slice(0, 4000)),
          meta: { sizeBytes: content.length, pageCount, detectedAt },
          extracted: { pages },
        };
      } catch (err) {
        // PDF parsing libraries are notoriously brittle. Treat parse errors
        // as recoverable: the caller still gets the classified document and
        // can hand it to a different tool or have the LLM read a screenshot.
        return {
          id,
          filename: input.filename,
          kind,
          layoutHint: input.layoutHint,
          meta: { sizeBytes: content.length, detectedAt },
          extracted: {
            pages: [],
            extractionError: err instanceof Error ? err.message : String(err),
          },
        };
      }
    }
    case "ccda-xml": {
      return {
        id,
        filename: input.filename,
        kind,
        layoutHint: input.layoutHint,
        meta: { sizeBytes: content.length, detectedAt },
        extracted: content.toString("utf8"),
      };
    }
    default:
      return {
        id,
        filename: input.filename,
        kind: "unknown",
        meta: { sizeBytes: content.length, detectedAt },
        extracted: undefined,
      };
  }
}

function guessPdfLayout(textHead: string): LayoutHint | undefined {
  const lower = textHead.toLowerCase();
  if (lower.includes("mychart") || lower.includes("past visit details") || lower.includes("after visit summary")) return "mychart";
  if (lower.includes("ciox") || lower.includes("datavant") || lower.includes("authorization for release")) return "ciox";
  if (lower.includes("memberhealthsummaryexport") || lower.includes("caresync")) return "caresync";
  if (lower.includes("discharge summary")) return "discharge-summary";
  if (lower.includes("operative report") || lower.includes("operation performed")) return "operative-report";
  if (lower.includes("specimen") && lower.includes("reference range")) return "lab-report";
  if (lower.includes("impression:") && lower.includes("findings:")) return "imaging-read";
  return "generic";
}

/**
 * extract_fhir is intentionally a thin shim over a document handle. The MCP
 * tool returns the ingested document's extracted content + layout hint;
 * the chat (Claude/ChatGPT) does the structured extraction by calling the
 * subsequent build_ips_bundle tool with the parsed structure.
 *
 * This keeps us out of the business of trying to ship a brittle MyChart
 * parser and matches the handoff's "LLM-in-the-loop" guidance.
 */
export interface ExtractFhirInput {
  document: IngestedDocument;
}

export interface ExtractFhirOutput {
  documentId: string;
  kind: DocumentKind;
  layoutHint?: LayoutHint;
  /** For PDFs: the per-page plain text. For JSON/FHIR: the parsed object. */
  extracted: unknown;
  /** Hint to the calling LLM about what's expected next. */
  next: string;
}

export function extractFhir(input: ExtractFhirInput): ExtractFhirOutput {
  const { document } = input;
  let next = "Call build_ips_bundle with structured patient/conditions/medications/...";
  if (document.kind === "pdf") {
    next =
      "Read the per-page text below, identify Conditions / Medications / Procedures / Observations / Immunizations, then call build_ips_bundle with structured arrays. Use the layoutHint to apply format-specific heuristics (mychart: extract Assessment + numbered Plan; caresync: extract date-anchored timeline entries; ciox: skip first ~5 admin pages).";
  } else if (document.kind === "fhir-bundle" || document.kind === "ips-bundle") {
    next =
      "The document is already a FHIR Bundle. You can pass it directly to create_smart_health_link as the payload, or call build_mega_bundle to combine it with additional priority/archive documents.";
  } else if (document.kind === "shl-jwe") {
    next =
      "If decryption succeeded, the extracted field contains the parsed bundle. Otherwise re-call ingest_document with the jweKey from the SHL URI's `key` field.";
  }
  return {
    documentId: document.id,
    kind: document.kind,
    layoutHint: document.layoutHint,
    extracted: document.extracted,
    next,
  };
}

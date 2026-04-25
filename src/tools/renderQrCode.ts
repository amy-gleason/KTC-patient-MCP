import QRCode from "qrcode";
import { audit } from "../backend/audit.js";
import { RenderQrCodeInput, type RenderQrCodeInputT } from "../schemas/toolSchemas.js";
import { resolveViewer } from "../backend/shlink.js";

export interface QrResult {
  link: string;
  encoded: string;
  style: "raw" | "viewer_wrapped" | "universal";
  svg: string;
  pngBase64: string;
  pngDataUrl?: string;
}

function extractLinkId(link: string): string {
  // Only used for audit correlation. Does not reveal PHI.
  const m = link.match(/(?:manifest|file)\/([0-9a-f-]{36})/i);
  return m ? m[1] : "unknown";
}

/** Pull the raw shlink:/<payload> out of any input (raw, viewer-wrapped URL, etc.). */
function extractShlink(input: string): string | undefined {
  const m = input.match(/shlink:\/([A-Za-z0-9_-]+)/);
  return m ? `shlink:/${m[1]}` : undefined;
}

function buildEncoded(input: RenderQrCodeInputT): string {
  const shlink = extractShlink(input.link);
  if (input.style === "raw") {
    return shlink ?? input.link;
  }
  // viewer_wrapped and universal both produce the same content: a viewer URL
  // with the shlink in the fragment. The distinction is intent — universal is
  // "use this as your single QR for both phone cameras and SHL scanners".
  const viewerPrefix = resolveViewer(input.viewer ?? "commonhealth");
  if (!viewerPrefix || !shlink) return input.link;
  const sep = viewerPrefix.includes("#") ? "" : "#";
  return `${viewerPrefix}${sep}${shlink}`;
}

export async function renderQrCode(rawInput: unknown): Promise<QrResult> {
  const input: RenderQrCodeInputT = RenderQrCodeInput.parse(rawInput);
  const encoded = buildEncoded(input);

  const qrOptions = {
    errorCorrectionLevel: input.errorCorrection,
    margin: input.margin,
    width: input.size,
  };

  const svg = await QRCode.toString(encoded, { ...qrOptions, type: "svg" });
  const pngBuf = await QRCode.toBuffer(encoded, { ...qrOptions, type: "png" });
  const pngBase64 = pngBuf.toString("base64");

  audit("qr.rendered", extractLinkId(input.link), {
    size: input.size,
    style: input.style,
  });

  return {
    link: input.link,
    encoded,
    style: input.style,
    svg,
    pngBase64,
    pngDataUrl: input.includeDataUrl ? `data:image/png;base64,${pngBase64}` : undefined,
  };
}

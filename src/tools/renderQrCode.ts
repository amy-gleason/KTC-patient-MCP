import QRCode from "qrcode";
import { audit } from "../backend/audit.js";
import { RenderQrCodeInput, type RenderQrCodeInputT } from "../schemas/toolSchemas.js";

export interface QrResult {
  link: string;
  svg: string;
  pngBase64: string;
  pngDataUrl?: string;
}

function extractLinkId(link: string): string {
  // Only used for audit correlation. Does not reveal PHI.
  const m = link.match(/manifest\/([0-9a-f-]{36})/i);
  return m ? m[1] : "unknown";
}

export async function renderQrCode(rawInput: unknown): Promise<QrResult> {
  const input: RenderQrCodeInputT = RenderQrCodeInput.parse(rawInput);

  const qrOptions = {
    errorCorrectionLevel: "M" as const,
    margin: input.margin,
    width: input.size,
  };

  const svg = await QRCode.toString(input.link, { ...qrOptions, type: "svg" });
  const pngBuf = await QRCode.toBuffer(input.link, { ...qrOptions, type: "png" });
  const pngBase64 = pngBuf.toString("base64");

  audit("qr.rendered", extractLinkId(input.link), { size: input.size });

  return {
    link: input.link,
    svg,
    pngBase64,
    pngDataUrl: input.includeDataUrl ? `data:image/png;base64,${pngBase64}` : undefined,
  };
}

import { base64UrlEncode } from "./crypto.js";

/**
 * SMART Health Link payload per the SMART Health Links v1 spec.
 * https://docs.smarthealthit.org/smart-health-links/
 */
export interface ShlinkPayload {
  url: string;
  key: string; // base64url-encoded 32-byte key (43 chars)
  exp?: number; // epoch seconds
  flag?: string; // combination of "L", "P", "U"
  label?: string;
  v?: number;
}

export function buildShlinkUri(payload: ShlinkPayload, viewerPrefix?: string): string {
  const json = JSON.stringify(payload);
  const encoded = base64UrlEncode(Buffer.from(json, "utf8"));
  const uri = `shlink:/${encoded}`;
  if (viewerPrefix) {
    const sep = viewerPrefix.includes("#") ? "" : "#";
    return `${viewerPrefix}${sep}${uri}`;
  }
  return uri;
}

export function parseShlinkUri(uri: string): ShlinkPayload {
  const hashIdx = uri.indexOf("shlink:/");
  if (hashIdx === -1) {
    throw new Error("Not a SMART Health Link URI");
  }
  const encoded = uri.slice(hashIdx + "shlink:/".length);
  const padded = encoded.replace(/-/g, "+").replace(/_/g, "/");
  const json = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(json) as ShlinkPayload;
}

export function computeFlag(opts: { passcode: boolean; longTerm?: boolean; singleUse?: boolean }): string | undefined {
  let flag = "";
  if (opts.longTerm) flag += "L";
  if (opts.passcode) flag += "P";
  if (opts.singleUse) flag += "U";
  return flag || undefined;
}

export type ViewerOption = "commonhealth" | "vaxx" | "none" | string;

const VIEWER_PRESETS: Record<string, string> = {
  commonhealth: "https://viewer.commonhealth.org/",
  vaxx: "https://demo.vaxx.link/viewer",
};

/**
 * Resolve a viewer option to a URL prefix. Returns undefined if no viewer
 * should be applied (i.e. emit raw shlink:/ only).
 *
 * Per the handoff spec, the canonical reference viewer at
 * viewer.smarthealthit.org has been unreliable; commonhealth and vaxx are
 * the working alternatives as of April 2026.
 */
export function resolveViewer(opt: ViewerOption | undefined): string | undefined {
  if (!opt || opt === "none") return undefined;
  if (VIEWER_PRESETS[opt]) return VIEWER_PRESETS[opt];
  if (opt.startsWith("https://")) return opt;
  return undefined;
}

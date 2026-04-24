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

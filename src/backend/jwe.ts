import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { base64UrlDecode, base64UrlEncode } from "./crypto.js";

/**
 * Minimal JWE compact serialization with alg="dir" and enc="A256GCM".
 * This matches what the SMART Health Links manifest expects for `embedded` payloads.
 * Format: protected_header_b64url..iv_b64url.ciphertext_b64url.tag_b64url
 */

export interface JweOptions {
  cty?: string; // content type, e.g. "application/fhir+json"
}

export function encryptJwe(plaintext: Buffer, keyBytes: Buffer, opts: JweOptions = {}): string {
  if (keyBytes.length !== 32) {
    throw new Error("JWE A256GCM key must be 32 bytes");
  }
  const header: Record<string, string> = {
    alg: "dir",
    enc: "A256GCM",
  };
  if (opts.cty) header.cty = opts.cty;

  const protectedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header), "utf8"));
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes, iv);
  // AAD per RFC 7516 is the ASCII bytes of the encoded protected header.
  cipher.setAAD(Buffer.from(protectedHeader, "ascii"));
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();

  return [
    protectedHeader,
    "", // encrypted CEK — empty for alg=dir
    base64UrlEncode(iv),
    base64UrlEncode(ct),
    base64UrlEncode(tag),
  ].join(".");
}

export function decryptJwe(token: string, keyBytes: Buffer): Buffer {
  const parts = token.split(".");
  if (parts.length !== 5) throw new Error("Invalid JWE compact token");
  const [protectedHeader, , ivEnc, ctEnc, tagEnc] = parts;
  const iv = base64UrlDecode(ivEnc);
  const ct = base64UrlDecode(ctEnc);
  const tag = base64UrlDecode(tagEnc);
  const decipher = createDecipheriv("aes-256-gcm", keyBytes, iv);
  decipher.setAAD(Buffer.from(protectedHeader, "ascii"));
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

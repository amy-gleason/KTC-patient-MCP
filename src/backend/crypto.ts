import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

const ALGO = "aes-256-gcm";

export interface EncryptedPayload {
  ciphertext: string; // base64
  iv: string; // base64
  authTag: string; // base64
}

export function encryptJson(plaintextObj: unknown, keyBytes: Buffer): EncryptedPayload {
  if (keyBytes.length !== 32) {
    throw new Error("Encryption key must be 32 bytes");
  }
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, keyBytes, iv);
  const plaintext = Buffer.from(JSON.stringify(plaintextObj), "utf8");
  const ct = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ct.toString("base64"),
    iv: iv.toString("base64"),
    authTag: tag.toString("base64"),
  };
}

export function decryptJson<T = unknown>(payload: EncryptedPayload, keyBytes: Buffer): T {
  const iv = Buffer.from(payload.iv, "base64");
  const ct = Buffer.from(payload.ciphertext, "base64");
  const tag = Buffer.from(payload.authTag, "base64");
  const decipher = createDecipheriv(ALGO, keyBytes, iv);
  decipher.setAuthTag(tag);
  const pt = Buffer.concat([decipher.update(ct), decipher.final()]);
  return JSON.parse(pt.toString("utf8")) as T;
}

export function randomBase64Url(lengthBytes = 32): string {
  return randomBytes(lengthBytes)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlEncode(buf: Buffer | string): string {
  const b = typeof buf === "string" ? Buffer.from(buf, "utf8") : buf;
  return b
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

export function base64UrlDecode(s: string): Buffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - (s.length % 4)) % 4);
  return Buffer.from(padded, "base64");
}

export function hashPasscode(passcode: string, saltHex?: string): { hash: string; salt: string } {
  const salt = saltHex ? Buffer.from(saltHex, "hex") : randomBytes(16);
  const hash = scryptSync(passcode, salt, 64).toString("hex");
  return { hash, salt: salt.toString("hex") };
}

export function verifyPasscode(passcode: string, expectedHash: string, saltHex: string): boolean {
  const { hash } = hashPasscode(passcode, saltHex);
  const a = Buffer.from(hash, "hex");
  const b = Buffer.from(expectedHash, "hex");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

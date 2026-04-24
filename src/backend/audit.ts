import { appendFileSync } from "node:fs";

export type AuditEvent =
  | "link.created"
  | "link.accessed"
  | "link.revoked"
  | "link.status_checked"
  | "link.access_denied"
  | "qr.rendered";

interface AuditRecord {
  timestamp: string;
  event: AuditEvent;
  linkId: string;
  actor?: string;
  meta?: Record<string, string | number | boolean>;
}

// Fields that must never be logged. Defense in depth — the audit() API only
// accepts a small shape, but this guards against accidental expansion.
const DISALLOWED_META_KEYS = new Set([
  "passcode",
  "payload",
  "bundle",
  "patient",
  "name",
  "dob",
  "ssn",
  "mrn",
  "ciphertext",
  "key",
  "encryptionKey",
]);

let destination: "stdout" | string = "stdout";

export function configureAudit(dest: string): void {
  destination = dest === "stdout" ? "stdout" : dest;
}

export function audit(
  event: AuditEvent,
  linkId: string,
  meta?: AuditRecord["meta"],
  actor?: string,
): void {
  const safeMeta: AuditRecord["meta"] = {};
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (DISALLOWED_META_KEYS.has(k)) continue;
      safeMeta[k] = v;
    }
  }
  const record: AuditRecord = {
    timestamp: new Date().toISOString(),
    event,
    linkId,
    actor,
    meta: Object.keys(safeMeta).length ? safeMeta : undefined,
  };
  const line = JSON.stringify(record);
  if (destination === "stdout") {
    // eslint-disable-next-line no-console
    console.log(line);
  } else {
    appendFileSync(destination, line + "\n", { encoding: "utf8" });
  }
}

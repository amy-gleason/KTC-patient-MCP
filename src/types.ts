export type ResourceType =
  | "fhir-bundle"
  | "ips"
  | "medication-list"
  | "visit-summary"
  | "insurance-card";

export type LinkStatus = "active" | "expired" | "revoked";

export interface StoredLink {
  id: string;
  resourceType: ResourceType;
  label: string;
  createdAt: number; // epoch seconds
  expiresAt: number; // epoch seconds
  passcodeHash?: string; // scrypt hash, not plaintext
  passcodeSalt?: string; // hex
  encryptionKey: string; // base64url, per-link payload key (for manifest encryption)
  ciphertext: string; // base64 encrypted payload (AES-256-GCM), may be empty if by reference
  iv: string; // base64 GCM IV
  authTag: string; // base64 GCM auth tag
  revoked: boolean;
  revokedAt?: number;
  accessCount: number;
  lastAccessedAt?: number;
  byReference?: string; // optional external FHIR reference (no PHI stored locally)
}

export interface CreateLinkResult {
  id: string;
  /** Raw shlink:/ URI — for SHL-native scanners. */
  shlinkUri: string;
  /** Viewer-wrapped URL ("universal" QR target) — works with phone cameras AND SHL scanners. */
  viewerUrl: string;
  /** Direct JWE bytes URL (only meaningful when flag includes "U"). Static-host friendly. */
  fileUrl: string;
  /** Manifest URL (SHL spec POST endpoint). Used when flag does NOT include "U". */
  manifestUrl: string;
  /** SHL flag string actually applied (e.g. "U", "PU", "LP"). */
  flag?: string;
  expiresAt: number;
  resourceType: ResourceType;
  label: string;
  passcodeRequired: boolean;
}

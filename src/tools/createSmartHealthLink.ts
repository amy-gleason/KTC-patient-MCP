import { randomBytes } from "node:crypto";
import { audit } from "../backend/audit.js";
import {
  base64UrlEncode,
  encryptJson,
  hashPasscode,
  randomBase64Url,
} from "../backend/crypto.js";
import type { LinkStore } from "../backend/storage.js";
import { buildShlinkUri, computeFlag, resolveViewer } from "../backend/shlink.js";
import type { AppConfig } from "../config.js";
import { CreateSmartHealthLinkInput, type CreateSmartHealthLinkInputT } from "../schemas/toolSchemas.js";
import type { CreateLinkResult } from "../types.js";

export interface CreateSmartHealthLinkDeps {
  store: LinkStore;
  config: AppConfig;
}

export function createSmartHealthLink(
  rawInput: unknown,
  deps: CreateSmartHealthLinkDeps,
): CreateLinkResult {
  const input: CreateSmartHealthLinkInputT = CreateSmartHealthLinkInput.parse(rawInput);

  const now = Math.floor(Date.now() / 1000);
  const ttl = Math.min(
    input.expiresInSeconds ?? deps.config.defaultTtlSeconds,
    deps.config.maxTtlSeconds,
  );
  const expiresAt = now + ttl;

  // Per-link encryption key for SHL manifest content (32 bytes base64url).
  const manifestKey = randomBytes(32);
  const manifestKeyB64Url = base64UrlEncode(manifestKey);

  // Encrypt payload at rest using the server's payload key, keeping the
  // per-link key separate so revocation invalidates cryptographic access.
  let ciphertext = "";
  let iv = "";
  let authTag = "";
  if (input.payload !== undefined) {
    const enc = encryptJson(input.payload, deps.config.payloadKey);
    ciphertext = enc.ciphertext;
    iv = enc.iv;
    authTag = enc.authTag;
  }

  let passcodeHash: string | undefined;
  let passcodeSalt: string | undefined;
  if (input.passcode) {
    const hashed = hashPasscode(input.passcode);
    passcodeHash = hashed.hash;
    passcodeSalt = hashed.salt;
  }

  const record = deps.store.create({
    resourceType: input.resourceType,
    label: input.label,
    expiresAt,
    passcodeHash,
    passcodeSalt,
    encryptionKey: manifestKeyB64Url,
    ciphertext,
    iv,
    authTag,
    byReference: input.bundleReference,
  });

  // Per the handoff spec, U-flag direct-file mode is the static-friendly default.
  // Set explicitly to false to fall back to manifest mode.
  const useDirectFile = input.singleUse !== false;
  const flag = computeFlag({
    passcode: !!input.passcode,
    longTerm: !!input.longTerm,
    singleUse: useDirectFile,
  });

  const base = deps.config.publicBaseUrl.replace(/\/$/, "");
  const manifestUrl = `${base}/shl/manifest/${record.id}`;
  const fileUrl = `${base}/shl/file/${record.id}.jwe`;
  // U-flag points the SHL `url` field at the direct JWE file. Otherwise at the manifest.
  const shlUrl = useDirectFile ? fileUrl : manifestUrl;

  const viewerPrefix =
    resolveViewer(input.viewer ?? "commonhealth") ?? deps.config.viewerPrefix;

  const shlinkUri = buildShlinkUri(
    {
      url: shlUrl,
      key: manifestKeyB64Url,
      exp: expiresAt,
      label: input.label,
      flag,
      v: 1,
    },
    // Build raw URI without viewer wrapping — we surface both forms separately.
    undefined,
  );

  const viewerUrl = viewerPrefix
    ? buildShlinkUri(
        {
          url: shlUrl,
          key: manifestKeyB64Url,
          exp: expiresAt,
          label: input.label,
          flag,
          v: 1,
        },
        viewerPrefix,
      )
    : shlinkUri;

  // Audit creation (no PHI — only safe metadata).
  audit("link.created", record.id, {
    resourceType: record.resourceType,
    expiresAt: record.expiresAt,
    hasPasscode: !!passcodeHash,
    byReference: !!record.byReference,
    flag: flag ?? "",
    directFile: useDirectFile,
  });

  return {
    id: record.id,
    shlinkUri,
    viewerUrl,
    fileUrl,
    manifestUrl,
    flag,
    expiresAt,
    resourceType: record.resourceType,
    label: record.label,
    passcodeRequired: !!passcodeHash,
  };
}

// Random bytes re-export helper is not needed; imports are used above.
export const __randomBase64UrlForTests = randomBase64Url;

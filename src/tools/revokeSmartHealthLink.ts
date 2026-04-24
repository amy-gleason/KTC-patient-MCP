import { audit } from "../backend/audit.js";
import type { LinkStore } from "../backend/storage.js";
import {
  RevokeSmartHealthLinkInput,
  type RevokeSmartHealthLinkInputT,
} from "../schemas/toolSchemas.js";

export interface RevokeResult {
  id: string;
  revoked: boolean;
  revokedAt?: number;
  status: "revoked" | "not-found" | "already-revoked";
}

export function revokeSmartHealthLink(
  rawInput: unknown,
  store: LinkStore,
): RevokeResult {
  const input: RevokeSmartHealthLinkInputT = RevokeSmartHealthLinkInput.parse(rawInput);

  const existing = store.get(input.id);
  if (!existing) {
    audit("link.revoked", input.id, { result: "not-found" });
    return { id: input.id, revoked: false, status: "not-found" };
  }
  if (existing.revoked) {
    return {
      id: input.id,
      revoked: true,
      revokedAt: existing.revokedAt,
      status: "already-revoked",
    };
  }

  const updated = store.revoke(input.id);
  audit("link.revoked", input.id, {
    result: "ok",
    reason: input.reason ?? "",
  });
  return {
    id: input.id,
    revoked: true,
    revokedAt: updated?.revokedAt,
    status: "revoked",
  };
}

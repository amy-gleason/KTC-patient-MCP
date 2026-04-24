import { audit } from "../backend/audit.js";
import type { LinkStore } from "../backend/storage.js";
import {
  GetSmartHealthLinkStatusInput,
  type GetSmartHealthLinkStatusInputT,
} from "../schemas/toolSchemas.js";
import type { LinkStatus, ResourceType } from "../types.js";

export interface StatusResult {
  id: string;
  status: LinkStatus | "not-found";
  resourceType?: ResourceType;
  label?: string;
  createdAt?: number;
  expiresAt?: number;
  accessCount?: number;
  lastAccessedAt?: number;
  revokedAt?: number;
  passcodeRequired?: boolean;
}

export function getSmartHealthLinkStatus(
  rawInput: unknown,
  store: LinkStore,
): StatusResult {
  const input: GetSmartHealthLinkStatusInputT = GetSmartHealthLinkStatusInput.parse(rawInput);

  const rec = store.get(input.id);
  if (!rec) {
    audit("link.status_checked", input.id, { result: "not-found" });
    return { id: input.id, status: "not-found" };
  }
  const status = store.status(input.id) as LinkStatus;
  audit("link.status_checked", input.id, { status });
  return {
    id: rec.id,
    status,
    resourceType: rec.resourceType,
    label: rec.label,
    createdAt: rec.createdAt,
    expiresAt: rec.expiresAt,
    accessCount: rec.accessCount,
    lastAccessedAt: rec.lastAccessedAt,
    revokedAt: rec.revokedAt,
    passcodeRequired: !!rec.passcodeHash,
  };
}

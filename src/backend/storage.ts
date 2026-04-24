import { randomUUID } from "node:crypto";
import type { LinkStatus, ResourceType, StoredLink } from "../types.js";

/**
 * In-memory store for SMART Health Link metadata + encrypted payload.
 * Swap this for a persistent store (Postgres, Redis) in production.
 */
export class LinkStore {
  private links = new Map<string, StoredLink>();

  create(input: Omit<StoredLink, "id" | "createdAt" | "revoked" | "accessCount">): StoredLink {
    const id = randomUUID();
    const record: StoredLink = {
      ...input,
      id,
      createdAt: Math.floor(Date.now() / 1000),
      revoked: false,
      accessCount: 0,
    };
    this.links.set(id, record);
    return record;
  }

  get(id: string): StoredLink | undefined {
    return this.links.get(id);
  }

  revoke(id: string): StoredLink | undefined {
    const rec = this.links.get(id);
    if (!rec) return undefined;
    rec.revoked = true;
    rec.revokedAt = Math.floor(Date.now() / 1000);
    return rec;
  }

  recordAccess(id: string): void {
    const rec = this.links.get(id);
    if (!rec) return;
    rec.accessCount += 1;
    rec.lastAccessedAt = Math.floor(Date.now() / 1000);
  }

  status(id: string): LinkStatus | "not-found" {
    const rec = this.links.get(id);
    if (!rec) return "not-found";
    if (rec.revoked) return "revoked";
    if (rec.expiresAt <= Math.floor(Date.now() / 1000)) return "expired";
    return "active";
  }

  all(): StoredLink[] {
    return [...this.links.values()];
  }

  clear(): void {
    this.links.clear();
  }
}

export const RESOURCE_TYPES: ResourceType[] = [
  "fhir-bundle",
  "ips",
  "medication-list",
  "visit-summary",
  "insurance-card",
];

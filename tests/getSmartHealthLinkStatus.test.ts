import { describe, expect, it } from "vitest";
import { createSmartHealthLink } from "../src/tools/createSmartHealthLink.js";
import { getSmartHealthLinkStatus } from "../src/tools/getSmartHealthLinkStatus.js";
import { revokeSmartHealthLink } from "../src/tools/revokeSmartHealthLink.js";
import { testConfig, testStore } from "./helpers.js";

describe("get_smart_health_link_status", () => {
  it("returns active for a fresh link", () => {
    const store = testStore();
    const config = testConfig();
    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: {} },
      { store, config },
    );
    const status = getSmartHealthLinkStatus({ id: created.id }, store);
    expect(status.status).toBe("active");
    expect(status.resourceType).toBe("ips");
    expect(status.accessCount).toBe(0);
  });

  it("returns revoked after revoke", () => {
    const store = testStore();
    const config = testConfig();
    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: {} },
      { store, config },
    );
    revokeSmartHealthLink({ id: created.id }, store);
    const status = getSmartHealthLinkStatus({ id: created.id }, store);
    expect(status.status).toBe("revoked");
    expect(status.revokedAt).toBeGreaterThan(0);
  });

  it("returns expired when past expiry", () => {
    const store = testStore();
    const config = testConfig({ maxTtlSeconds: 1, defaultTtlSeconds: 1 });
    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: {}, expiresInSeconds: 1 },
      { store, config },
    );
    // Force expiry by rewriting.
    const rec = store.get(created.id)!;
    rec.expiresAt = Math.floor(Date.now() / 1000) - 10;
    const status = getSmartHealthLinkStatus({ id: created.id }, store);
    expect(status.status).toBe("expired");
  });

  it("returns not-found for unknown IDs", () => {
    const store = testStore();
    const status = getSmartHealthLinkStatus({ id: "00000000-0000-0000-0000-000000000000" }, store);
    expect(status.status).toBe("not-found");
  });

  it("tracks access count after manifest access", () => {
    const store = testStore();
    const config = testConfig();
    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: {} },
      { store, config },
    );
    store.recordAccess(created.id);
    store.recordAccess(created.id);
    const status = getSmartHealthLinkStatus({ id: created.id }, store);
    expect(status.accessCount).toBe(2);
    expect(status.lastAccessedAt).toBeGreaterThan(0);
  });
});

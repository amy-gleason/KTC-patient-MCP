import { describe, expect, it } from "vitest";
import { createSmartHealthLink } from "../src/tools/createSmartHealthLink.js";
import { revokeSmartHealthLink } from "../src/tools/revokeSmartHealthLink.js";
import { testConfig, testStore } from "./helpers.js";

describe("revoke_smart_health_link", () => {
  it("revokes an existing link", () => {
    const store = testStore();
    const config = testConfig();
    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: { ok: true } },
      { store, config },
    );
    const result = revokeSmartHealthLink({ id: created.id }, store);
    expect(result.status).toBe("revoked");
    expect(result.revoked).toBe(true);
    expect(store.get(created.id)?.revoked).toBe(true);
  });

  it("reports not-found for missing IDs", () => {
    const store = testStore();
    const result = revokeSmartHealthLink({ id: "00000000-0000-0000-0000-000000000000" }, store);
    expect(result.status).toBe("not-found");
    expect(result.revoked).toBe(false);
  });

  it("is idempotent", () => {
    const store = testStore();
    const config = testConfig();
    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: {} },
      { store, config },
    );
    const first = revokeSmartHealthLink({ id: created.id }, store);
    const second = revokeSmartHealthLink({ id: created.id }, store);
    expect(first.status).toBe("revoked");
    expect(second.status).toBe("already-revoked");
  });
});

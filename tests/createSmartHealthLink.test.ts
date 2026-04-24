import { describe, expect, it } from "vitest";
import { createSmartHealthLink } from "../src/tools/createSmartHealthLink.js";
import { parseShlinkUri } from "../src/backend/shlink.js";
import { MOCK_IPS_BUNDLE } from "../src/mock/fhirBundle.js";
import { testConfig, testStore } from "./helpers.js";

describe("create_smart_health_link", () => {
  it("creates a link for an inline IPS bundle", () => {
    const store = testStore();
    const config = testConfig();
    const result = createSmartHealthLink(
      { resourceType: "ips", label: "My IPS", payload: MOCK_IPS_BUNDLE },
      { store, config },
    );
    expect(result.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(result.shlinkUri).toMatch(/^shlink:\//);
    expect(result.resourceType).toBe("ips");
    expect(result.passcodeRequired).toBe(false);

    const payload = parseShlinkUri(result.shlinkUri);
    expect(payload.url).toContain(`/shl/manifest/${result.id}`);
    expect(payload.key).toHaveLength(43);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("enforces passcode flag and hashes passcode", () => {
    const store = testStore();
    const config = testConfig();
    const result = createSmartHealthLink(
      {
        resourceType: "medication-list",
        label: "Meds",
        payload: { resourceType: "Bundle", entry: [] },
        passcode: "hunter2",
      },
      { store, config },
    );
    expect(result.passcodeRequired).toBe(true);
    const payload = parseShlinkUri(result.shlinkUri);
    expect(payload.flag).toContain("P");

    const rec = store.get(result.id)!;
    expect(rec.passcodeHash).toBeTruthy();
    expect(rec.passcodeHash).not.toBe("hunter2");
  });

  it("clamps expiration to max TTL", () => {
    const store = testStore();
    const config = testConfig({ maxTtlSeconds: 60 });
    const result = createSmartHealthLink(
      {
        resourceType: "ips",
        label: "x",
        payload: { ok: true },
        expiresInSeconds: 10_000_000,
      },
      { store, config },
    );
    const now = Math.floor(Date.now() / 1000);
    expect(result.expiresAt - now).toBeLessThanOrEqual(60);
  });

  it("accepts bundleReference instead of inline payload", () => {
    const store = testStore();
    const config = testConfig();
    const result = createSmartHealthLink(
      {
        resourceType: "fhir-bundle",
        label: "ext",
        bundleReference: "https://ehr.example.org/fhir/Bundle/123",
      },
      { store, config },
    );
    const rec = store.get(result.id)!;
    expect(rec.ciphertext).toBe("");
    expect(rec.byReference).toBe("https://ehr.example.org/fhir/Bundle/123");
  });

  it("rejects input missing both payload and reference", () => {
    const store = testStore();
    const config = testConfig();
    expect(() =>
      createSmartHealthLink(
        { resourceType: "ips", label: "x" },
        { store, config },
      ),
    ).toThrow();
  });

  it("rejects invalid resourceType", () => {
    const store = testStore();
    const config = testConfig();
    expect(() =>
      createSmartHealthLink(
        { resourceType: "labs", label: "x", payload: {} },
        { store, config },
      ),
    ).toThrow();
  });
});

import { describe, expect, it } from "vitest";
import { createSmartHealthLink } from "../src/tools/createSmartHealthLink.js";
import { parseShlinkUri } from "../src/backend/shlink.js";
import { MOCK_IPS_BUNDLE } from "../src/mock/fhirBundle.js";
import { testConfig, testStore } from "./helpers.js";

describe("create_smart_health_link", () => {
  it("creates a link for an inline IPS bundle (default U-flag direct-file mode)", () => {
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
    // Default flag should include U for static-friendly direct-file delivery.
    expect(result.flag).toContain("U");
    expect(result.fileUrl).toContain(`/shl/file/${result.id}.jwe`);
    expect(result.manifestUrl).toContain(`/shl/manifest/${result.id}`);
    // Default viewer is commonhealth; viewerUrl wraps the shlink in the fragment.
    expect(result.viewerUrl).toContain("viewer.commonhealth.org");
    expect(result.viewerUrl).toContain("shlink:/");

    const payload = parseShlinkUri(result.shlinkUri);
    expect(payload.url).toContain(`/shl/file/${result.id}.jwe`);
    expect(payload.key).toHaveLength(43);
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it("falls back to manifest URL when singleUse=false", () => {
    const store = testStore();
    const config = testConfig();
    const result = createSmartHealthLink(
      {
        resourceType: "ips",
        label: "x",
        payload: { ok: true },
        singleUse: false,
      },
      { store, config },
    );
    const payload = parseShlinkUri(result.shlinkUri);
    expect(payload.url).toContain("/shl/manifest/");
    expect(payload.flag ?? "").not.toContain("U");
  });

  it("respects viewer='none' (raw shlink only)", () => {
    const store = testStore();
    const config = testConfig();
    const result = createSmartHealthLink(
      {
        resourceType: "ips",
        label: "x",
        payload: { ok: true },
        viewer: "none",
      },
      { store, config },
    );
    expect(result.viewerUrl).toBe(result.shlinkUri);
    expect(result.viewerUrl).toMatch(/^shlink:\//);
  });

  it("accepts a custom viewer URL", () => {
    const store = testStore();
    const config = testConfig();
    const result = createSmartHealthLink(
      {
        resourceType: "ips",
        label: "x",
        payload: { ok: true },
        viewer: "https://demo.vaxx.link/viewer",
      },
      { store, config },
    );
    expect(result.viewerUrl).toContain("demo.vaxx.link/viewer");
    expect(result.viewerUrl).toContain("#shlink:/");
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
        // Use manifest mode so the passcode check runs at manifest fetch.
        singleUse: false,
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

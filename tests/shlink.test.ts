import { describe, expect, it } from "vitest";
import { buildShlinkUri, computeFlag, parseShlinkUri } from "../src/backend/shlink.js";
import { decryptJwe, encryptJwe } from "../src/backend/jwe.js";
import { randomBytes } from "node:crypto";

describe("shlink helpers", () => {
  it("roundtrips an SHL payload", () => {
    const payload = {
      url: "https://mcp.test/shl/manifest/abc",
      key: "AAAA".repeat(10) + "AAA",
      exp: 1_700_000_000,
      flag: "P",
      label: "test",
      v: 1,
    };
    const uri = buildShlinkUri(payload);
    expect(uri).toMatch(/^shlink:\//);
    const decoded = parseShlinkUri(uri);
    expect(decoded).toEqual(payload);
  });

  it("prepends a viewer prefix when provided", () => {
    const uri = buildShlinkUri(
      { url: "https://x/y", key: "k" },
      "https://viewer.example.org/",
    );
    expect(uri.startsWith("https://viewer.example.org/#shlink:/")).toBe(true);
    const decoded = parseShlinkUri(uri);
    expect(decoded.url).toBe("https://x/y");
  });

  it("computes P/U flags", () => {
    expect(computeFlag({ passcode: true, singleUse: true })).toBe("PU");
    expect(computeFlag({ passcode: false })).toBeUndefined();
  });
});

describe("JWE A256GCM", () => {
  it("roundtrips", () => {
    const key = randomBytes(32);
    const pt = Buffer.from("hello world", "utf8");
    const token = encryptJwe(pt, key, { cty: "application/fhir+json" });
    expect(token.split(".")).toHaveLength(5);
    const out = decryptJwe(token, key);
    expect(out.toString("utf8")).toBe("hello world");
  });

  it("fails with wrong key", () => {
    const key = randomBytes(32);
    const wrong = randomBytes(32);
    const token = encryptJwe(Buffer.from("x"), key);
    expect(() => decryptJwe(token, wrong)).toThrow();
  });
});

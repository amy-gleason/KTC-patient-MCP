import { randomBytes } from "node:crypto";
import { LinkStore } from "../src/backend/storage.js";
import type { AppConfig } from "../src/config.js";

export function testConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  return {
    publicBaseUrl: "https://mcp.test",
    host: "127.0.0.1",
    port: 8443,
    payloadKey: randomBytes(32),
    defaultTtlSeconds: 3600,
    maxTtlSeconds: 7 * 24 * 3600,
    auditLog: "stdout",
    ...overrides,
  };
}

export function testStore(): LinkStore {
  return new LinkStore();
}

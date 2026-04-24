import { randomBytes } from "node:crypto";

export interface AppConfig {
  publicBaseUrl: string;
  host: string;
  port: number;
  tlsCertFile?: string;
  tlsKeyFile?: string;
  payloadKey: Buffer;
  defaultTtlSeconds: number;
  maxTtlSeconds: number;
  auditLog: string;
  viewerPrefix?: string;
}

let cached: AppConfig | undefined;

function readKey(envVal: string | undefined): Buffer {
  if (!envVal) {
    // Ephemeral key — warn loudly. Never do this in production.
    // eslint-disable-next-line no-console
    console.warn(
      "[ktc-patient-mcp] PAYLOAD_ENCRYPTION_KEY not set — generating ephemeral key. Data will not survive restarts.",
    );
    return randomBytes(32);
  }
  const key = Buffer.from(envVal, "hex");
  if (key.length !== 32) {
    throw new Error(`PAYLOAD_ENCRYPTION_KEY must be 32 bytes hex (got ${key.length} bytes)`);
  }
  return key;
}

export function loadConfig(overrides: Partial<AppConfig> = {}): AppConfig {
  if (cached && Object.keys(overrides).length === 0) return cached;
  const port = parseInt(process.env.PORT ?? "8443", 10);
  const cfg: AppConfig = {
    publicBaseUrl: process.env.PUBLIC_BASE_URL ?? `http://localhost:${port}`,
    host: process.env.HOST ?? "0.0.0.0",
    port,
    tlsCertFile: process.env.TLS_CERT_FILE,
    tlsKeyFile: process.env.TLS_KEY_FILE,
    payloadKey: readKey(process.env.PAYLOAD_ENCRYPTION_KEY),
    defaultTtlSeconds: parseInt(process.env.DEFAULT_LINK_TTL_SECONDS ?? "3600", 10),
    maxTtlSeconds: parseInt(process.env.MAX_LINK_TTL_SECONDS ?? "2592000", 10),
    auditLog: process.env.AUDIT_LOG ?? "stdout",
    viewerPrefix: process.env.SHLINK_VIEWER_PREFIX,
    ...overrides,
  };
  cached = cfg;
  return cfg;
}

export function resetConfigForTests(cfg?: Partial<AppConfig>): AppConfig {
  cached = undefined;
  return loadConfig(cfg);
}

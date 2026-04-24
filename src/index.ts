import { readFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import { createServer as createHttpsServer } from "node:https";

import { configureAudit } from "./backend/audit.js";
import { LinkStore } from "./backend/storage.js";
import { loadConfig } from "./config.js";
import { buildApp } from "./server.js";

async function main(): Promise<void> {
  const config = loadConfig();
  configureAudit(config.auditLog);

  const store = new LinkStore();
  const { app } = buildApp({ store, config });

  const useTls = config.tlsCertFile && config.tlsKeyFile;
  const server = useTls
    ? createHttpsServer(
        {
          cert: readFileSync(config.tlsCertFile!),
          key: readFileSync(config.tlsKeyFile!),
        },
        app,
      )
    : createHttpServer(app);

  server.listen(config.port, config.host, () => {
    const proto = useTls ? "https" : "http";
    // eslint-disable-next-line no-console
    console.log(
      `[ktc-patient-mcp] listening on ${proto}://${config.host}:${config.port} (public: ${config.publicBaseUrl})`,
    );
    if (!useTls) {
      // eslint-disable-next-line no-console
      console.warn("[ktc-patient-mcp] running without TLS — dev only. Set TLS_CERT_FILE and TLS_KEY_FILE for HTTPS.");
    }
  });
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("[ktc-patient-mcp] fatal", err);
  process.exit(1);
});

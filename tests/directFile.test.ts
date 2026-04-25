import { afterEach, describe, expect, it } from "vitest";
import http from "node:http";
import { AddressInfo } from "node:net";

import { LinkStore } from "../src/backend/storage.js";
import { decryptJwe } from "../src/backend/jwe.js";
import { buildApp } from "../src/server.js";
import { createSmartHealthLink } from "../src/tools/createSmartHealthLink.js";
import { revokeSmartHealthLink } from "../src/tools/revokeSmartHealthLink.js";
import { testConfig } from "./helpers.js";
import { parseShlinkUri } from "../src/backend/shlink.js";
import { base64UrlDecode } from "../src/backend/crypto.js";
import type { AppConfig } from "../src/config.js";

interface RunningServer {
  url: string;
  close: () => Promise<void>;
  store: LinkStore;
  config: AppConfig;
}

async function startServer(): Promise<RunningServer> {
  const store = new LinkStore();
  const config = testConfig({ publicBaseUrl: "http://127.0.0.1:0" });
  const { app } = buildApp({ store, config });
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  config.publicBaseUrl = `http://127.0.0.1:${port}`;
  return {
    url: config.publicBaseUrl,
    store,
    config,
    close: () => new Promise((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

describe("/shl/file/:id.jwe direct-file route", () => {
  const cleanups: Array<() => Promise<void>> = [];
  afterEach(async () => {
    while (cleanups.length) await cleanups.pop()!();
  });

  it("serves the JWE bytes with application/jose + CORS headers", async () => {
    const { url, store, config, close } = await startServer();
    cleanups.push(close);

    const created = createSmartHealthLink(
      {
        resourceType: "ips",
        label: "test",
        payload: { resourceType: "Bundle", id: "b1" },
      },
      { store, config },
    );

    const res = await fetch(`${url}/shl/file/${created.id}.jwe`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/jose");
    expect(res.headers.get("access-control-allow-origin")).toBe("*");

    const jwe = await res.text();
    expect(jwe.split(".")).toHaveLength(5);

    // The shlink URI's `key` decrypts the JWE.
    const shl = parseShlinkUri(created.shlinkUri);
    const keyBytes = base64UrlDecode(shl.key);
    const pt = decryptJwe(jwe, keyBytes);
    const obj = JSON.parse(pt.toString("utf8"));
    expect(obj.resourceType).toBe("Bundle");
    expect(obj.id).toBe("b1");
  });

  it("returns 410 after revocation", async () => {
    const { url, store, config, close } = await startServer();
    cleanups.push(close);

    const created = createSmartHealthLink(
      { resourceType: "ips", label: "x", payload: { ok: true } },
      { store, config },
    );
    revokeSmartHealthLink({ id: created.id }, store);

    const res = await fetch(`${url}/shl/file/${created.id}.jwe`);
    expect(res.status).toBe(410);
  });

  it("returns 404 for unknown IDs", async () => {
    const { url, close } = await startServer();
    cleanups.push(close);

    const res = await fetch(`${url}/shl/file/00000000-0000-0000-0000-000000000000.jwe`);
    expect(res.status).toBe(404);
  });

  it("OPTIONS preflight returns 204 with CORS headers", async () => {
    const { url, close } = await startServer();
    cleanups.push(close);

    const res = await fetch(`${url}/shl/file/anything.jwe`, { method: "OPTIONS" });
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

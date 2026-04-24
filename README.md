# ktc-patient-mcp

A remote **Model Context Protocol (MCP)** server that lets ChatGPT and Claude
generate **SMART Health Links** (SHL) and QR codes for sharing FHIR data.

This is a working prototype. It implements the four tools requested:

| Tool | Purpose |
|---|---|
| `create_smart_health_link` | Create an SHL URI for a FHIR Bundle, IPS, medication list, visit summary, or insurance card. Supports expiration + optional passcode. |
| `render_qr_code` | Render an SHL URI as SVG + PNG. |
| `revoke_smart_health_link` | Revoke a previously-generated link. |
| `get_smart_health_link_status` | Check whether a link is active, expired, or revoked. |

It talks the SMART Health Links v1 wire format, so the output works with any
compliant reader (e.g. the `Killtheclipboard` reader repo).

---

## Quick start (local)

```bash
# 1. Install
npm install

# 2. Generate a 32-byte payload encryption key and a dev TLS cert
export PAYLOAD_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
mkdir -p certs
openssl req -x509 -newkey rsa:2048 -nodes -days 365 \
  -keyout certs/server.key -out certs/server.crt \
  -subj "/CN=localhost"

# 3. Configure and run
cp .env.example .env
# edit .env: set PAYLOAD_ENCRYPTION_KEY and PUBLIC_BASE_URL=https://localhost:8443
npm run dev
```

Plain HTTP (no TLS) is supported for local iteration — just omit
`TLS_CERT_FILE` and `TLS_KEY_FILE`. **Do not deploy without TLS.**

### Endpoints

- `GET /healthz` — liveness probe
- `GET /mcp/sse` — MCP SSE stream (remote transport)
- `POST /mcp/messages?sessionId=…` — MCP client → server messages
- `POST /shl/manifest/:id` — SHL manifest (per SHL v1 spec; accepts optional `passcode`)
- `GET  /shl/manifest/:id` — convenience variant for dev testing

---

## Running tests

```bash
npm test
```

Covers every tool, the SHL URI encoder/decoder, and the JWE A256GCM wrapper.

---

## Connecting to Claude (claude.ai + Claude Code)

### claude.ai (Custom Connector, remote MCP)

1. Deploy the server so it has a public HTTPS URL (e.g. `https://your-host.example/`).
2. In claude.ai → Settings → Connectors → **Add custom connector**:
   - **Name**: `KTC Patient MCP`
   - **URL**: `https://your-host.example/mcp/sse`
3. Enable the connector in a chat. The four tools appear.

### Claude Code (CLI)

Add to `~/.claude.json` or the project's `.mcp.json`:

```jsonc
{
  "mcpServers": {
    "ktc-patient-mcp": {
      "type": "sse",
      "url": "https://your-host.example/mcp/sse"
    }
  }
}
```

Then `claude mcp list` should show the tools.

---

## Connecting to ChatGPT

ChatGPT supports MCP via **custom connectors** (ChatGPT Pro/Team/Enterprise →
Settings → Connectors → Add).

1. Choose **Custom MCP**.
2. Provide the SSE URL: `https://your-host.example/mcp/sse`.
3. Name it and approve the four tools it advertises.

> If your ChatGPT plan exposes MCP only via the **Responses API**, pass the
> same URL as an `mcp_server` tool entry in the API request.

---

## Example tool calls

### Create a SHL from an IPS bundle

```jsonc
// Claude / ChatGPT invocation:
{
  "tool": "create_smart_health_link",
  "arguments": {
    "resourceType": "ips",
    "label": "Pat's IPS",
    "expiresInSeconds": 3600,
    "passcode": "1234",
    "payload": {
      "resourceType": "Bundle",
      "type": "document",
      "entry": [ /* ... */ ]
    }
  }
}
```

Response:

```jsonc
{
  "id": "d4c3…",
  "shlinkUri": "shlink:/eyJ1cmwiOi…",
  "viewerUrl": "shlink:/eyJ1cmwiOi…",
  "expiresAt": 1769000000,
  "resourceType": "ips",
  "label": "Pat's IPS",
  "passcodeRequired": true
}
```

### Render a QR code

```jsonc
{
  "tool": "render_qr_code",
  "arguments": {
    "link": "shlink:/eyJ1cmwiOi…",
    "size": 512
  }
}
```

Returns `svg`, `pngBase64`, and `pngDataUrl` (plus an inline `image` content
block that Claude/ChatGPT render directly).

### Revoke

```jsonc
{ "tool": "revoke_smart_health_link", "arguments": { "id": "d4c3…", "reason": "patient request" } }
```

### Check status

```jsonc
{ "tool": "get_smart_health_link_status", "arguments": { "id": "d4c3…" } }
```

---

## Security model

| Concern | How it's handled |
|---|---|
| Raw PHI at rest | Payload is encrypted with AES-256-GCM using `PAYLOAD_ENCRYPTION_KEY`. You can also pass `bundleReference` and skip storing raw data entirely. |
| SHL recipient key | A fresh 32-byte key is generated per link, stored alongside the record, and surfaced only through the SHL URI. |
| Passcode | Stored as a scrypt hash with a per-record salt. Verified in constant time. |
| Expiration | Defaults to 1 hour; capped at `MAX_LINK_TTL_SECONDS` (30 days). |
| Revocation | Revoked links return `410 Gone` at the manifest endpoint. |
| Audit logs | Structured JSON events: `link.created`, `link.accessed`, `link.revoked`, `link.status_checked`, `link.access_denied`, `qr.rendered`. **No PHI** — a deny-list strips known sensitive keys. |
| Manifest transport | JWE compact (alg=dir, enc=A256GCM) with the per-link key, matching the SHL v1 manifest spec. |
| Input validation | Every tool validates with Zod before touching storage. |
| Tool / backend separation | Tools in `src/tools/`, storage/crypto/audit in `src/backend/`. The MCP layer (`src/server.ts`) never touches raw key material directly. |

---

## Project layout

```
src/
  index.ts                 # HTTP(S) entrypoint
  server.ts                # Express + MCP SSE wiring, manifest endpoint
  config.ts                # Env parsing, key loading
  types.ts                 # Shared types
  schemas/toolSchemas.ts   # Zod input schemas for the four tools
  tools/
    createSmartHealthLink.ts
    renderQrCode.ts
    revokeSmartHealthLink.ts
    getSmartHealthLinkStatus.ts
  backend/
    crypto.ts              # AES-GCM + scrypt helpers
    jwe.ts                 # JWE A256GCM for SHL manifest
    shlink.ts              # shlink:/ URI encoder/decoder
    storage.ts              # In-memory link store
    audit.ts               # Structured no-PHI audit log
  mock/fhirBundle.ts       # Mock IPS bundle for testing
tests/
  *.test.ts                # Vitest unit tests for each tool + helpers
```

---

## What remains to make this production-ready

1. **Persistence.** The `LinkStore` is in-memory. Swap for Postgres or Redis with the same interface; encrypt the payload column at the DB layer too (envelope encryption).
2. **Key management.** Move `PAYLOAD_ENCRYPTION_KEY` into AWS KMS / GCP KMS / Vault. Rotate keys with an explicit `kid` on each record.
3. **AuthN / AuthZ on the MCP transport.** Today anyone who reaches `/mcp/sse` can call the tools. Add OAuth 2.1 per the MCP spec, or mTLS for machine clients. Scope tokens per patient.
4. **Rate limiting + brute-force protection.** Passcode endpoints should throttle (e.g. 5 attempts then exponential backoff) and lock after repeated failures.
5. **Single-use enforcement.** The `U` flag is surfaced in the SHL payload but the manifest endpoint does not yet auto-revoke on first access. Add when you pick a persistence layer.
6. **Proper JSON-Schema emission.** `src/server.ts` uses a minimal Zod→JSON-Schema shim. Replace with `zod-to-json-schema` for full fidelity (refs, unions, defaults, descriptions on arrays).
7. **Audit sink.** `stdout` or a file is fine for dev. In production ship to a SIEM (Splunk, Datadog, CloudWatch) with a tamper-evident store.
8. **Compliance.** HIPAA BAAs for any hosting/logging vendors. Data residency controls. Access reviews. BAA-covered KMS. Encryption-in-transit attestation. Pen test.
9. **Viewer integration.** Set `SHLINK_VIEWER_PREFIX` to a trusted viewer (e.g. the `Killtheclipboard` reader) so the `viewerUrl` lands users in a full reader UI.
10. **Observability.** OpenTelemetry traces, health metrics, per-tool latency/error SLOs.
11. **SBOM + supply chain.** `npm audit`, Dependabot, signed releases, reproducible builds.
12. **UX.** Per-link human-readable names without PHI, revocation reasons from a controlled vocabulary, optional recipient allowlist on the manifest endpoint.

---

## License

Prototype — no license granted. Internal use only.

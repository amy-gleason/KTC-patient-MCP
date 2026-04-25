# ktc-patient-mcp

A remote **Model Context Protocol (MCP)** server that lets ChatGPT and Claude
generate **SMART Health Links** (SHL) and QR codes for sharing FHIR data.

This is a working prototype. It implements the four tools requested:

### Share-link tools

| Tool | Purpose |
|---|---|
| `create_smart_health_link` | Create an SHL URI for a FHIR Bundle, IPS, medication list, visit summary, or insurance card. Supports expiration + optional passcode + viewer wrapping. |
| `render_qr_code` | Render an SHL URI as SVG + PNG (raw / viewer-wrapped / universal). |
| `revoke_smart_health_link` | Revoke a previously-generated link. |
| `get_smart_health_link_status` | Check whether a link is active, expired, or revoked. |

### Health-pipeline tools (NEW)

| Tool | Purpose |
|---|---|
| `ingest_documents` | Classify + parse uploaded files (FHIR JSON, SHL JWE, PDF, CCDA). Returns per-page text for PDFs + a layout hint (mychart / ciox / caresync / etc.). |
| `extract_fhir` | Return the parsed content of an ingested document with a `next` suggestion — designed for LLM-in-the-loop structured extraction. |
| `build_ips_bundle` | Build a conformant IPS FHIR R4 Bundle with dedupe, RxNorm/SNOMED/CVX codings, "no known allergy" convention, and Composition section assembly (LOINC 60591-5). |
| `render_clinical_summary_pdf` | Dr-Rider-style ~3-page clinical summary PDF (one-liner / history / regimen / prior therapies / active issues / assessment). |
| `render_timeline_pdf` | Reverse-chronological 3-column timeline PDF, grouped by month. |
| `render_ips_narrative_pdf` | Single-column narrative PDF, one section per Composition entry. |
| `render_insurance_card_pdf` | Wallet-card front + back PDF for an insurance card. |
| `build_mega_bundle` | Combine an IPS Bundle + priority inline DocumentReferences + archive URL refs + insurance Coverage. Strips inline base64 from existing DocRefs to keep size manageable. |

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
- `GET /shl/file/:id.jwe` — **direct-file mode (default, U-flag)**. Returns raw JWE bytes with `Content-Type: application/jose` + permissive CORS. Static-host friendly per the handoff spec.
- `POST /shl/manifest/:id` — manifest mode (used when `singleUse: false`). Accepts optional `passcode`.
- `GET  /shl/manifest/:id` — convenience GET for dev testing.

---

## Running tests

```bash
npm test
```

Covers every tool, the SHL URI encoder/decoder, and the JWE A256GCM wrapper.

---

## Deploying

- **Fly.io** (recommended for prototypes) — see [`docs/DEPLOY-FLY.md`](./docs/DEPLOY-FLY.md). One-time setup is ~5 minutes.
- **Render / Railway** — push the repo, set `PAYLOAD_ENCRYPTION_KEY`, deploy. The provided `Dockerfile` works as-is.
- **Your own host** — `docker build . && docker run -p 8443:8080 -e PAYLOAD_ENCRYPTION_KEY=...` behind any TLS terminator (Caddy, Nginx, Cloudflare).

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

## Alignment with `HANDOFF-spec-for-MCP.md`

This server's SHL/QR layer follows the conventions captured in
`HANDOFF-spec-for-MCP.md` (the production-tested spec from the proof-of-concept).
Specifically:

| Handoff spec rule | How this server complies |
|---|---|
| JWE header **must not** include `zip: "DEF"` | `src/backend/jwe.ts` emits `{alg:"dir", enc:"A256GCM", cty:"application/fhir+json"}` only. |
| Default `flag: "U"` (direct-file) for static-friendly delivery | Default in `create_smart_health_link`. Set `singleUse: false` to fall back to manifest mode. |
| `Content-Type: application/jose` on the JWE URL | Set explicitly in `handleDirectFile`; tested. |
| CORS `*` on the JWE URL | `Access-Control-Allow-Origin: *` plus methods/headers + `Cache-Control` per the handoff Vercel config. |
| Universal QR (one QR for phone cameras AND SHL scanners) | `render_qr_code` `style: "universal"` (default) wraps the shlink in a viewer URL fragment. |
| Viewer fallbacks (`viewer.smarthealthit.org` is unreliable) | `viewer` parameter accepts `commonhealth` (default), `vaxx`, `none`, or a custom https URL. |
| 32-byte AES-GCM key, 43-char base64url in SHL payload | `randomBytes(32)` → `base64UrlEncode` (43 chars). |
| Patient-readable `label` in SHL payload | First-class field on `create_smart_health_link`. |
| Audit logs without PHI | Audit log strips a key deny-list (`patient`, `bundle`, `passcode`, `mrn`, …). |

### Coverage of the handoff's 10-stage pipeline

| Handoff stage | Status |
|---|---|
| 1. Ingest (`.json`, `.jwe`, `.pdf`, `.xml`, image) | ✅ `ingest_documents` |
| 2. Parse CareSync timeline PDF (column-aware) | ⚠️ Text-only via pdf-parse + LLM-in-the-loop. No pdfplumber-equivalent in the JS ecosystem. |
| 3. Parse MyChart visit PDFs | ⚠️ Text + layout hint; LLM extracts Assessment + Plan. |
| 4. Parse Ciox/Datavant ROI packets | ⚠️ Text + layout hint; LLM skips pages 1–5. |
| 5. Slug-normalize PDF filenames | ❌ Not yet — host-time concern, easy add. |
| 6. Build IPS bundle | ✅ `build_ips_bundle` (RxNorm / SNOMED / CVX / ICD-10-CM, "no known allergy" SNOMED 716186003, drops thin immunization sections, Composition LOINC 60591-5, patient-authored author marker). |
| 7. Merge + dedupe | ✅ Built into `build_ips_bundle` (medication brand/generic equivalence map, condition concept canonicalization, drops CareSync `code.text="Active"` junk). |
| 8. Render PDFs (IPS narrative / clinical summary / timeline) | ✅ Three render tools using `pdfkit` (Georgia for clinical, Helvetica for tables). |
| 9. Encrypt as JWE (no `zip`!) | ✅ `src/backend/jwe.ts`. |
| 10. Generate SHL URI + QR + host | ✅ `create_smart_health_link` + `render_qr_code` + `/shl/file/:id.jwe`. |
| Bonus: Insurance | ✅ `render_insurance_card_pdf` + FHIR `Coverage` resources merged into the mega-bundle. |

PDF parsing is the one area where the JS ecosystem can't match Python's
pdfplumber. The handoff itself notes the parsers benefit from LLM-in-the-loop,
so `ingest_documents` extracts plain text + a `layoutHint` and returns it for
the calling chat to do the structured extraction.

### Typical end-to-end flow

```
ingest_documents([visit1.pdf, lab2.pdf, mychart-export.json])
     ↓ returns documentId + per-page text + layoutHint per file
extract_fhir({documentId})    ← LLM reads pages, builds structured data
     ↓
build_ips_bundle({patient, conditions, medications, allergies, ...})
     ↓ returns IPS Bundle JSON
render_clinical_summary_pdf(...)   ┐
render_timeline_pdf(...)            ├─ → 3 priority-tier PDFs
render_ips_narrative_pdf({bundle}) ┘
     ↓
build_mega_bundle({
  ipsBundle, insuranceCards: [...],
  inlineDocuments: [{title:"Clinical Summary", contentBase64:"…"}, …],
  archiveDocuments: [{title:"Old labs 2018", url:"https://…"}, …],
})
     ↓ returns mega-bundle JSON
create_smart_health_link({resourceType:"fhir-bundle", payload: <mega>})
     ↓ returns shlinkUri + viewerUrl + fileUrl
render_qr_code({link: viewerUrl, style:"universal"})
     ↓ returns PNG + SVG QR ready for printing or texting
```

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
    "style": "universal",          // default — works for phone camera AND SHL scanners
    "viewer": "commonhealth",      // or "vaxx", "none", or a custom https URL
    "size": 512
  }
}
```

Returns `svg`, `pngBase64`, `pngDataUrl`, the `encoded` string actually
rendered into the QR, and the `style`. Plus an inline `image` content block
that Claude/ChatGPT render directly.

QR styles:
- `raw` — encodes only `shlink:/…` (SHL-native scanners only; phone camera will fail to open)
- `viewer_wrapped` — encodes `https://viewer.commonhealth.org/#shlink:/…` (phone cameras open it)
- `universal` (default) — same as `viewer_wrapped`; SHL-native scanners regex out the shlink. **One QR for both.**

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

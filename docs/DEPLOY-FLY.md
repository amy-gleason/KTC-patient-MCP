# Deploy to Fly.io

Tested with Fly's `flyctl` v0.3+.

## 0. Prereqs

```bash
fly auth whoami    # confirm you're logged in
```

## 1. Pick an app name

Fly app names are global. Replace `YOUR-APP-NAME` everywhere below.
Edit `fly.toml` and change the `app = "..."` line to match.

```bash
# from the repo root
sed -i.bak 's/^app = .*/app = "YOUR-APP-NAME"/' fly.toml && rm fly.toml.bak
```

## 2. Create the app (no deploy yet)

```bash
fly launch --no-deploy --copy-config --name YOUR-APP-NAME --region iad
```

Flags explained:
- `--no-deploy` — we want to set secrets first.
- `--copy-config` — uses the committed `fly.toml` instead of regenerating.
- `--region iad` — change to your nearest region (`fly platform regions`).

If `fly launch` asks about a Postgres DB or Upstash Redis, **say no**. The
prototype uses an in-memory store.

## 3. Set the encryption key as a Fly secret

```bash
fly secrets set \
  PAYLOAD_ENCRYPTION_KEY=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))") \
  -a YOUR-APP-NAME
```

This is a **persistent** 32-byte key used to encrypt SHL payloads at rest.
Losing it makes existing links un-decryptable. Back it up before rotating.

You don't need to set `PUBLIC_BASE_URL` — the app auto-derives
`https://YOUR-APP-NAME.fly.dev` from `FLY_APP_NAME` at boot.

## 4. Deploy

```bash
fly deploy -a YOUR-APP-NAME
```

First build pulls Node 22 + installs deps; ~2–3 minutes. Subsequent deploys
are faster thanks to layer caching.

## 5. Verify

```bash
curl https://YOUR-APP-NAME.fly.dev/healthz
# → {"ok":true}

# SSE endpoint should return text/event-stream and stay open:
curl -i -N https://YOUR-APP-NAME.fly.dev/mcp/sse
# Press Ctrl-C after you see the first event.
```

Tail logs:

```bash
fly logs -a YOUR-APP-NAME
```

## 6. Wire ChatGPT or Claude to it

- **ChatGPT**: Settings → Connectors → Create custom connector → URL =
  `https://YOUR-APP-NAME.fly.dev/mcp/sse`. Auth: None (for now).
- **Claude (claude.ai)**: Settings → Connectors → Add custom connector → same
  URL.
- **Claude Code**: add to your `.mcp.json`:
  ```jsonc
  {
    "mcpServers": {
      "ktc-patient-mcp": {
        "type": "sse",
        "url": "https://YOUR-APP-NAME.fly.dev/mcp/sse"
      }
    }
  }
  ```

## Caveats for the prototype on Fly

| Issue | Mitigation |
|---|---|
| `fly.toml` has `auto_stop_machines = "stop"` and `min_machines_running = 0`. The machine sleeps after idle, dropping in-memory link records. | For demos this is fine — just regenerate links. For anything serious, set `min_machines_running = 1` and switch the `LinkStore` to a Fly Postgres / Upstash Redis. |
| In-memory `LinkStore`. A scale-out (`fly scale count 2`) would not share state across machines. | Stay at count 1 until you swap the store. |
| Audit log goes to stdout → `fly logs`. Logs are ephemeral. | Pipe to a SIEM (Datadog/Logtail) for retention. |
| No auth on `/mcp/sse`. Anyone with the URL can call the tools. | Treat the URL as a secret, or add OAuth 2.1 (MCP spec) before sharing. |
| Payload key in a Fly secret. | OK for prototype. For prod, fetch from KMS at boot and avoid storing it in Fly's secret store. |

## Updating

```bash
git pull
fly deploy -a YOUR-APP-NAME
```

## Tearing it down

```bash
fly apps destroy YOUR-APP-NAME
```

This is the **revocation kill-switch** in the handoff: every SHL pointing at
this host instantly 404s after destroy (Fly's edge cache TTL is short).

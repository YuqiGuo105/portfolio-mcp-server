# MCP Connection Diagnostics

## Connected clients

Call `connection.check` on the existing public or admin MCP connection. The
response includes a readable Markdown report and structured checks with stable
codes and next actions. Set `locale` to `zh` for Chinese or `en` for English.

```json
{
  "locale": "zh",
  "client": {
    "protocolVersion": "2025-11-25",
    "schemaDialect": "draft-7",
    "observedFailure": { "phase": "registration", "httpStatus": 400 }
  },
  "invocations": [
    { "name": "Portfolio:search_portfolio" },
    { "name": "search_portfolio", "arguments": { "query": "architecture" } }
  ]
}
```

Client observations are explicitly self-reported, not verified server facts.
Omit fields you do not know. The service does not guess a client's capabilities.
The public connection checks only public tools. The admin connection checks the
tools currently registered for its verified managed role, including workspace
schemas. A missing private tool is indistinguishable from an unknown tool when
the caller lacks access.

Tool-name suggestions are **protocol names from the actual registry**, not a
fabricated `Portfolio:...` or `mcp_...` callable. Refresh discovery and use the
exact callable exposed by your client. A schema-valid write sample is not
approved or executed; business permissions, confirmation and current state are
still checked by the normal execution path.

## When login does not work

The service exposes `GET` and `POST /mcp/diagnostics?surface=admin`. It returns a
report even when the response is HTTP 401, 403, or 503. Public diagnostics use
`surface=public`; they do not read or validate an attached admin token.

Use the MCP **service origin**. A website reverse proxy may not forward this
route, so a proxy 404 does not prove that the diagnostic feature is broken.

```sh
node scripts/check-connection.mjs \
  --url http://127.0.0.1:8080 --surface admin --locale zh
```

For a signed-in check, pass `--authenticated`; the CLI reads
`MCP_DIAGNOSTICS_TOKEN` from the operator's environment and sends it only as an
Authorization header. Do not paste tokens into chat, command-line arguments,
URLs, diagnostic JSON, or source control. No token is sent by default, and the
CLI refuses credential-bearing URLs and redirects. Optional `--input sample.json`
loads bounded, non-sensitive diagnostic samples. Exit codes: 0 for pass/warn,
1 for a report with failures, 2 when no valid report could be obtained.

## Common outcomes

| Code | Meaning | Next step |
| --- | --- | --- |
| `session_required` | No signed-in session was supplied | Connect using OAuth |
| `session_expired` | The verified JWT has expired | Refresh or reconnect in the client |
| `session_expiring` | Less than five minutes remain | Refresh before the next operation |
| `token_invalid` | Token cannot be verified | Reconnect; do not reuse the token |
| `session_rejected` | The authorization service rejected the session | Reconnect; expiry was not assumed |
| `admin_access_denied` | Current managed account lacks access | Contact an administrator |
| `auth_service_unavailable` / `auth_verifier_unavailable` | Permission or signature verification service unavailable | Retry later; do not weaken access control |
| `oauth_discovery_*` / `pkce_s256_missing` | Discovery failed or required PKCE support is absent | Inspect issuer metadata and OAuth configuration |
| `client_reported_failure` | Client reported registration, refresh, handshake or tool-call failure | Investigate that phase; metadata alone is insufficient |
| `tool_name_mismatch` | A label or namespaced alias does not match a protocol tool | Refresh tool discovery |
| `tool_not_available` | Tool is not registered for this connection | Verify endpoint, permissions and discovery |
| `schema_stale` | Optional SHA-256 schema fingerprint differs | Reload the schema from `tools/list` |
| `arguments_invalid` / `arguments_ignored` | Sample arguments do not match the registered schema | Correct the reported fields |
| `catalog_unavailable` | Backend discovery failed | Retry discovery; do not assume tools were removed |

## Limits and guarantees

- No arbitrary probe URL can be supplied to the server. OAuth discovery reads
  only the configured issuer's origin, uses the SDK's discovery order, rejects
  redirects, limits metadata to 64 KiB, and has a five-second total deadline.
  Results are shared for 60 seconds to bound repeated probes.
- Up to 10 sample invocations and 16 KiB total sample JSON; HTTP requests are
  capped at 32 KiB. Validation reports field paths and error codes, not values.
- OAuth discovery checks metadata, issuer identity, HTTPS endpoints and PKCE
  S256. A registration endpoint is only an advertised capability, not evidence
  that registration, refresh or consent actually succeeded.
- Tokens are cryptographically verified before expiry or role is reported.
  User-editable metadata cannot grant administrator access. Authentication
  failures do not reveal private schemas, account emails, IPs or records.
- All HTTP reports are private/no-store. The CLI does not persist credentials.
  MCP calls reuse existing audit correlation; the pre-login HTTP report itself
  is not a new database record. `reportId` labels the returned report, while a
  returned `traceId` identifies the existing MCP request trace.
- Self-check never registers a client, refreshes credentials, changes permissions,
  executes sample tools, replays events or retries writes. It is diagnosis, not
  automatic repair or a security certification.

## Tests

```sh
npm run build
npm run check
npm test
E2E_CHROME=1 npm run test:e2e
```

The E2E harness exercises the real HTTP/MCP transport, JWT verification, managed
role lookup, OAuth discovery and registered schemas against isolated local
services. The existing Chrome workspace tests run alongside it. Third-party
browser consent and live client registration are deliberately not performed.

Protocol references: [MCP authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization),
[Supabase MCP authentication](https://supabase.com/docs/guides/auth/oauth-server/mcp-authentication).

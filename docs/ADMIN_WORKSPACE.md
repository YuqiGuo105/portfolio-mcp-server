# Admin MCP Workspace

The workspace is an MCP App, not a separate website or a second control plane.
It calls the existing role-filtered gateway tools and keeps business state in
the owning services. No new database, hosted frontend, or model invocation is
required.

## Open it

1. Connect `https://www.yuqi.site/mcp/admin` in an MCP Apps-capable client.
2. Complete administrator sign-in. Refresh tool discovery on an existing connection.
3. Ask `Open the admin workspace`, optionally specifying visitors, operations,
   or knowledge. The model calls `workspace.open_view`.

UI support depends on the client and its version. The standard resource uses
`text/html;profile=mcp-app` and `_meta.ui.resourceUri`; an OpenAI output-template
hint is also included. A client that only supports text still receives a
summary and the protected admin-console URL. The public portfolio plugin does
not gain any administrator tools.

## Tools

| Tool | Purpose | Side effects |
| --- | --- | --- |
| `workspace.open_view` | Open one bounded view and its UI resource | Read only |
| `workspace.get_view_data` | Filter, refresh, or page without mounting another UI | Read only |
| `workspace.get_item` | Read a visitor session, operation timeline, or knowledge record | Read only |
| `workspace.prepare_retry` | Check a current failed task and issue a five-minute signed review | No task execution |
| `workspace.confirm_retry` | Execute the reviewed retry with explicit confirmation | Authenticated, audited write |

Queries use nested `window`, `filter`, and `page` objects. Visitor and knowledge
pages default to 15 items and are capped at 25. Visitor paging reuses a fixed
time window of at most 31 days. Operation and failure lists each show the latest
25 records; session details show up to 25 events. Use the full admin console for
larger investigations. Network location and automation signals are evidence,
not proof of a person's identity or whether a visitor is human.

## Security and recovery

- Every admin MCP request verifies the existing JWT and managed role. Only
  `ADMIN` receives workspace tools or the resource, including direct calls.
- Backend catalog authorization, validation, audit correlation, and idempotency
  remain in the existing execution path. The app cannot dispatch arbitrary tools.
- Private record details travel in `_meta.workspace`; model-visible output is
  a concise summary. Metadata is not an authorization boundary: the authenticated
  client receives these details and must itself be trusted.
- No credentials, visitor data, or knowledge records are embedded in the static
  HTML. CSP permits no external connections or assets; scripts, styles, and the
  brand image are bundled. Record content is inserted as text, not HTML.
- Retry tickets bind the administrator, exact target, five-minute expiry, and
  stable idempotency key using a purpose-separated HMAC with the existing gateway
  secret. A tampered, expired, or different administrator's ticket fails closed.
- Confirm is app-visible and requires `confirmed: true`; UI visibility does not
  replace backend checks. Replaying the same ticket uses the same durable key.
- A timeout or uncertain response is not success. The UI blocks another retry
  in that widget and directs the operator to verify the operation timeline.
  Reloading the widget clears its in-memory display state, not backend history;
  inspect history before preparing a new retry after an uncertain result.
- An accepted retry means the request was accepted, not that downstream indexing
  or notification delivery completed. Outbox replay may invoke delivery workflows.

## Verification

```sh
npm ci
npm run build
npm run check
npm test
npx playwright install chromium
npm run test:e2e
```

Set `E2E_CHROME=1` to use installed Google Chrome instead of downloaded Chromium.
The browser suite uses the official MCP Apps `AppBridge`, a restrictive sandbox,
the real MCP HTTP/auth/catalog path, and an isolated fixture gateway. It covers
filters, pagination, timelines, knowledge escaping, explicit confirmation,
uncertain writes, partial outages, mobile scrolling, and theme changes.

An operator can additionally run an OAuth-backed, **read-only** live-data check:

```sh
E2E_CHROME=1 node scripts/verify-workspace-live.mjs --wait-for-deployment
```

Open the printed authorization URL and approve the named verification client.
The script first tests the local candidate UI against real backend reads, then
waits for the same UI bundle to reach production and tests the deployed resource.
Credentials stay in process memory; the localhost host requires a short-lived
cookie and same-origin requests. Both bridge layers reject production writes.
No private screenshots or records are committed. Omit `--wait-for-deployment`
to run only the candidate check. This validates the standard host protocol and
Chrome UI, not every third-party client's rendering behavior.

# Portfolio MCP Control Plane

A dual-boundary [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Yuqi Guo's portfolio](https://www.yuqi.site). Public clients receive a small, sanitized read-only surface. Authenticated administrators receive a role-scoped control plane generated from the platform's canonical internal tool catalog.

Both endpoints use stateless Streamable HTTP and support clients such as ChatGPT, Gemini, Claude, GitHub Copilot, and Cursor. Business operations remain owned by their backend services; this edge provides discovery, authentication, policy metadata, invocation and audit correlation.

## System Design

The edge view makes the public/admin trust boundary explicit and shows policy
enforcement, versioned tool discovery, confirmation-gated writes, typed domain
adapters, response sanitization, and auditable operational state.

<img src="docs/architecture/public-mcp-edge.svg" alt="Public Portfolio MCP edge architecture" width="100%" />

> **Maintain this diagram:** edit [`docs/architecture/public-mcp-edge.json`](docs/architecture/public-mcp-edge.json), then run `node scripts/render-architecture-diagram.mjs docs/architecture/public-mcp-edge.json`.

## Production Operating Model

This service exposes two deliberately separate trust boundaries:

- `/mcp` is the anonymous public edge. Its six curated tools are always read-only and sanitized.
- `/mcp/admin` is the authenticated control plane. It verifies the Supabase JWT, resolves the managed role and owner capability from admin-service, then dynamically registers only tools allowed for that principal.

Production boundaries:

| Boundary | Decision |
|---|---|
| Public clients | ChatGPT, Copilot, Claude, Cursor and similar clients use this server only |
| Tool scope | Public tools are read-only and return sanitized project/article/profile fields |
| Privileged writes | Available only on `/mcp/admin`; confirmation-gated and idempotent through the internal gateway |
| Response safety | Internal IDs, audit data, raw HTML, private delivery state, and long payloads are omitted or truncated |
| Failure mode | Gateway timeouts fail closed with concise MCP errors; no partial private payload is returned |

The browser admin console and Admin MCP endpoint share the same managed identity,
backend authorization and canonical tool catalog. A suspended or removed admin
therefore loses both UI and MCP access without a separate permission list.

## Tools

| Tool | Description | Inputs |
| --- | --- | --- |
| `search_projects` | Search projects by technology, architecture pattern, or keyword | `keyword`, optional `category` and `limit` |
| `get_project` | Retrieve the details and links for a project | `projectId` |
| `get_project_architecture` | Return pre-authored Mermaid diagrams stored with a project | `projectId` |
| `search_articles` | Search published technical articles and blog posts | `keyword`, optional `category` and `limit` |
| `get_article` | Retrieve a published article by ID | `articleId` |
| `get_profile` | Retrieve Yuqi's public experience, skills, education, and CV link | None |

All tools are read-only and non-destructive. Search results are limited to 20 items. Responses omit internal IDs, audit data, indexing state, raw HTML, and other private implementation fields; long content is truncated to a configurable maximum.

## Admin Control Plane

The Admin endpoint discovers its capabilities from `GET /api/tools` on the
internal MCP gateway. It does not maintain a second hard-coded copy of backend
operations. The current catalog covers these domains:

| Domain | Representative operations |
| --- | --- |
| Content | Search/get, create draft, update, publish, Search/RAG reindex |
| Recovery | Inspect failed jobs, retry jobs, replay outbox events, drain workers |
| Analytics | Visitor summary, top pages and referrer aggregates |
| Notifications | Subscribers, delivery status, retries, test delivery and subscription status |
| Support | Contact owner and verification-code unsubscribe workflow |
| Alerts | List/get rules and prepare/apply versioned rule changes |
| Access | Owner-only admin user listing, role assignment and suspension |

### Invocation workflow

```text
MCP client
  -> Supabase JWT verification
  -> admin-service managed role + owner lookup
  -> canonical gateway catalog
  -> role/owner filtered tools/list
  -> typed MCP input validation
  -> explicit confirmation for risky writes
  -> idempotency key assignment
  -> internal MCP gateway policy + adapter
  -> owning backend service
  -> correlated operation event
```

Write tools publish MCP annotations (`readOnlyHint`, `destructiveHint`,
`idempotentHint`, `openWorldHint`) so supporting clients can present the right
approval experience. An `_idempotencyKey` can be supplied by the client; the
server generates one when omitted. A tool marked `confirmRequired` will not run
unless `_confirmed=true`, and the internal gateway independently enforces the
same risk gate.

Admin identity management is owner-only. Those calls forward the original JWT
to admin-service, which enforces the owner invariant and writes its own audit
record. Operational tool events are also correlated into the platform timeline.

### Adding or changing a capability

1. Implement the operation in the backend service that owns the state.
2. Add or revise its definition in the internal gateway's `tool-catalog.yaml`.
3. Define role, risk, confirmation, dry-run support and typed parameters there.
4. Add gateway/backend contract and policy tests.
5. Deploy the backend and gateway. The Admin MCP catalog refreshes automatically.

Only public-friendly aliases and response sanitizers belong in this repository.
Do not duplicate domain state transitions or database access in the MCP edge.

## Run locally

### Prerequisites

- Node.js 20 or newer
- npm
- Access to the portfolio MCP gateway and its internal token

Clone and install the server:

```sh
git clone https://github.com/YuqiGuo105/portfolio-mcp-server.git
cd portfolio-mcp-server
npm ci
```

Set the required gateway configuration:

```sh
export MCP_GATEWAY_URL="https://your-gateway.example.com"
export MCP_GATEWAY_INTERNAL_TOKEN="your-shared-secret"
```

Start the server:

```sh
npm start
```

The MCP endpoint is available at `http://localhost:8080/mcp`; the health endpoint is available at `http://localhost:8080/health`.

For development with automatic restarts:

```sh
npm run dev
```

## Configuration

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `MCP_GATEWAY_INTERNAL_TOKEN` | Yes | Empty | Bearer token used to authenticate with the internal gateway |
| `MCP_GATEWAY_URL` | No | Deployed portfolio gateway | Base URL of the internal MCP gateway |
| `PORT` | No | `8080` | HTTP listening port |
| `GATEWAY_TIMEOUT_MS` | No | `10000` | Gateway request timeout in milliseconds |
| `SITE_URL` | No | `https://www.yuqi.site` | Base URL used to build canonical content links |
| `MAX_CONTENT_LENGTH` | No | `8000` | Maximum returned article or project body length |
| `SUPABASE_JWT_SECRET` | Admin endpoint | Empty | Verifies Supabase access tokens |
| `ADMIN_SERVICE_URL` | Admin endpoint | Empty | Resolves managed role, owner capability and owner-only operations |
| `ADMIN_ALLOWED_EMAILS` | Local fallback | Empty | Break-glass fallback used only when `ADMIN_SERVICE_URL` is absent |
| `ADMIN_AUTH_TIMEOUT_MS` | No | `5000` | Managed authorization lookup timeout |
| `TOOL_CATALOG_CACHE_TTL_MS` | No | `60000` | Canonical catalog cache duration |
| `TOOL_CATALOG_MAX_STALE_MS` | No | `900000` | Bounded stale catalog fallback during a gateway cold start |

Do not expose `MCP_GATEWAY_INTERNAL_TOKEN` in client configuration or commit it to source control. MCP clients connect only to this server's public `/mcp` endpoint.

## Connect an MCP client

The public endpoint is packaged as an installable Codex plugin and as portable
configuration examples for other MCP clients:

- [Codex plugin](plugins/yuqi-portfolio)
- [Cross-platform setup guide](docs/CLIENT_INTEGRATIONS.md)
- [Client configuration examples](docs/client-configs)

The production Streamable HTTP endpoint is:

```txt
https://www.yuqi.site/mcp
```

For Codex CLI, the direct installation command is:

```sh
codex mcp add yuqi-portfolio --url https://www.yuqi.site/mcp
codex mcp list
```

To install the complete plugin from its GitHub marketplace instead:

```sh
codex plugin marketplace add YuqiGuo105/portfolio-mcp-server
codex plugin add yuqi-portfolio@yuqi-portfolio-platform
```

The distributable plugin adds the same public server plus focused usage
instructions. The public plugin intentionally excludes `/mcp/admin`: privileged
tools require an authenticated administrator session and must never depend on a
token committed to a plugin or client configuration.

## Docker

Build and run the included production image:

```sh
docker build -t portfolio-mcp-server .
docker run --rm -p 8080:8080 \
  -e MCP_GATEWAY_URL="https://your-gateway.example.com" \
  -e MCP_GATEWAY_INTERNAL_TOKEN="your-shared-secret" \
  portfolio-mcp-server
```

Verify the service:

```sh
curl http://localhost:8080/health
```

## Related project

- [YuqiGuo105/Portfolio](https://github.com/YuqiGuo105/Portfolio) — the Next.js portfolio frontend and platform overview

## License

No license file is currently included. All rights are reserved unless a license is added.

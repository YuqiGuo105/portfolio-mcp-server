# Portfolio MCP Server

A public, read-only [Model Context Protocol (MCP)](https://modelcontextprotocol.io/) server for [Yuqi Guo's portfolio](https://www.yuqi.site). It lets MCP-compatible clients search projects and technical articles, inspect stored project architecture, and retrieve Yuqi's public professional profile.

The server exposes a stateless Streamable HTTP endpoint designed for clients such as ChatGPT, Claude, GitHub Copilot, and Cursor. It delegates content lookups to the portfolio platform's internal MCP gateway and sanitizes every response before returning it to the client.

## System Design

The edge view makes the public/admin trust boundary explicit and shows policy
enforcement, versioned tool discovery, confirmation-gated writes, typed domain
adapters, response sanitization, and auditable operational state.

<img src="docs/architecture/public-mcp-edge.svg" alt="Public Portfolio MCP edge architecture" width="100%" />

> **Maintain this diagram:** edit [`docs/architecture/public-mcp-edge.json`](docs/architecture/public-mcp-edge.json), then run `node scripts/render-architecture-diagram.mjs docs/architecture/public-mcp-edge.json`.

## Production Operating Model

This service is the **public MCP edge**, not the privileged admin tool runner.
It exposes a stable Streamable HTTP endpoint (`/mcp`) for external clients and
forwards only safe read operations to the internal gateway.

Production boundaries:

| Boundary | Decision |
|---|---|
| Public clients | ChatGPT, Copilot, Claude, Cursor and similar clients use this server only |
| Tool scope | Public tools are read-only and return sanitized project/article/profile fields |
| Privileged writes | Admin write tools run through the authenticated Portfolio admin console and internal MCP gateway, not this public server |
| Response safety | Internal IDs, audit data, raw HTML, private delivery state, and long payloads are omitted or truncated |
| Failure mode | Gateway timeouts fail closed with concise MCP errors; no partial private payload is returned |

For admin automation, use `https://www.yuqi.site/admin/agent`. That console
auto-runs read-only operations and stages write operations behind explicit
confirmation with the signed-in Supabase admin identity.

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

Do not expose `MCP_GATEWAY_INTERNAL_TOKEN` in client configuration or commit it to source control. MCP clients connect only to this server's public `/mcp` endpoint.

## Connect an MCP client

Configure your client with the deployed Streamable HTTP URL:

```txt
https://your-mcp-server.example.com/mcp
```

The exact configuration format varies by client. Choose **Streamable HTTP** as the transport when the client asks for a transport type.

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

# Development

Requires Node.js 20+ and npm. Meaningful tool calls also require access to the
internal gateway; this repository is not a standalone copy of all backend services.

```sh
git clone https://github.com/YuqiGuo105/portfolio-mcp-server.git
cd portfolio-mcp-server
npm ci
npm run build
npm run check
npm test
```

Supply `MCP_GATEWAY_URL` and `MCP_GATEWAY_INTERNAL_TOKEN` through your environment
or secret manager, then run `npm start`. The default port is `8080`; `/health` is
the health endpoint and `/mcp` is the public MCP route. Never commit real secrets.

<details>
<summary><strong>Runtime configuration</strong></summary>

| Variable | Purpose |
| --- | --- |
| `MCP_GATEWAY_URL` | Internal gateway origin; configure explicitly for your environment |
| `MCP_GATEWAY_INTERNAL_TOKEN` | Server-to-gateway credential; never distribute to clients |
| `PORT` | HTTP port, default `8080` |
| `SITE_URL` | Canonical origin, default `https://www.yuqi.site` |
| `GATEWAY_TIMEOUT_MS` | Default gateway deadline, `10000` ms |
| `CAREER_GATEWAY_TIMEOUT_MS` | Career gateway deadline, `30000` ms |
| `MAX_CONTENT_LENGTH` | Returned content bound, default `8000` |
| `SUPABASE_AUTH_ISSUER` | Admin JWT issuer and asymmetric JWKS discovery |
| `SUPABASE_JWT_SECRET` | Legacy HS256 verification, when that token format is used |
| `ADMIN_SERVICE_URL` | Managed authorization service for production |
| `ADMIN_ALLOWED_EMAILS` | Environment-only fallback without an admin service; not a substitute for production managed roles |
| `ADMIN_AUTH_TIMEOUT_MS` | Authorization deadline, `5000` ms |
| `TOOL_CATALOG_CACHE_TTL_MS` | Catalog refresh interval, `60000` ms |
| `TOOL_CATALOG_MAX_STALE_MS` | Bounded stale catalog fallback, `900000` ms |

</details>

<details>
<summary><strong>Browser tests and Docker</strong></summary>

```sh
npx playwright install chromium
npm run test:e2e
```

The E2E suite uses isolated services, real HTTP/MCP transport, and an MCP Apps
host. It does not prove every third-party client's UI or consent flow works.
Live verification is separate and requires deliberate administrator authorization.

```sh
docker build -t portfolio-mcp-server .
docker run --rm -p 8080:8080 \
  -e MCP_GATEWAY_URL -e MCP_GATEWAY_INTERNAL_TOKEN \
  portfolio-mcp-server
```

The Docker example forwards configured environment variables. Set up admin
authentication separately before enabling privileged connections.

</details>


[Back to the project overview](../README.md)

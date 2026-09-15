<p align="center">
  <img src="plugins/yuqi-portfolio/assets/icon.png" alt="Yuqi Portfolio" width="64" />
</p>
<h1 align="center">Portfolio MCP Gateway</h1>
<p align="center">
  <strong>Connect AI assistants to real knowledge and controlled actions.</strong>
</p>
<p align="center">
  Built by <strong>Yuqi Guo</strong>. Used with Claude and Codex.<br />
  Public answers with sources. Protected tools for platform administration.
</p>
<p align="center">
  <a href="https://www.yuqi.site/mcp-guide"><strong>Connect a Client</strong></a> &middot;
  <a href="#public-edition">Public Edition</a> &middot;
  <a href="#administrator-edition">Administrator Edition</a> &middot;
  <a href="#architecture">Architecture</a>
</p>

## What I Built

A **Model Context Protocol (MCP) gateway** that lets AI assistants search portfolio
knowledge and help authorized administrators operate the platform.

- **Grounded answers:** projects, articles, and professional background with source links.
- **Controlled access:** validated requests, role-based permissions, and required approvals for protected writes.
- **Recoverable workflows:** tracked outcomes, duplicate-request protection, and audit records across backend services.

**Stack:** Node.js &middot; MCP SDK &middot; Zod &middot; OAuth/JWT &middot; Java/Spring

## Public Edition

**Explore the portfolio from an AI conversation. No portfolio login required.**

Ask: *"Which project demonstrates Yuqi's distributed-systems experience?"*

<p align="center">
  <a href="docs/screenshots/codex-public-plugin.png">
    <img src="docs/screenshots/codex-public-plugin.png" alt="Yuqi Portfolio in Codex: project, architecture, and technical writing prompts" width="640" />
  </a>
</p>
<p align="center"><sub>Codex: discover projects, writing, and professional background.</sub></p>

<p align="center">
  <a href="docs/screenshots/claude-public-connector.png">
    <img src="docs/screenshots/claude-public-connector.png" alt="Claude public connector with read-only portfolio tools" width="640" />
  </a>
</p>
<p align="center"><sub>Claude: read-only tools. No private records or administrator actions.</sub></p>

**Endpoint:** `https://www.yuqi.site/mcp`

## Administrator Edition

**An authorized administrator account and OAuth consent are required.**
Signing in alone does not grant admin access.

Connect &rarr; sign in &rarr; approve access &rarr; use permitted tools.

<p align="center">
  <a href="docs/screenshots/admin-sign-in.png">
    <img src="docs/screenshots/admin-sign-in.png" alt="Administrator login with email/password and Google; public registration is disabled" width="480" />
  </a>
</p>
<p align="center"><sub>Sign in with an existing authorized account. Public registration is disabled.</sub></p>

<p align="center">
  <a href="docs/screenshots/claude-admin-connector.png">
    <img src="docs/screenshots/claude-admin-connector.png" alt="Claude administrator connector after authorization, showing read and write tool permissions" width="640" />
  </a>
</p>
<p align="center"><sub>After authorization: role-controlled tools with required write approvals.</sub></p>

| Investigate | Manage |
| --- | --- |
| Visitor activity and alert delivery | Content and knowledge records |
| Chat questions, final answers, and execution events | Publishing, indexing, and supported recovery |
| Service health, costs, and operation history | Alert rules and permitted budget settings |

**Endpoint:** `https://www.yuqi.site/mcp/admin`

## Architecture

The **Node.js edge** handles client connections and validated tool requests.
The **Java gateway and domain services** enforce policy, track operations, and own business data.

<p align="center">
  <a href="docs/architecture/public-mcp-edge.svg">
    <img src="docs/architecture/public-mcp-edge.svg" alt="MCP architecture: separate public and admin access, internal gateway, backend services, and audit tracking" width="960" />
  </a>
</p>
<p align="center"><a href="docs/architecture/public-mcp-edge.svg"><strong>View full-size architecture</strong></a></p>

**Reliability:** stable idempotency keys, persisted outcomes, bounded retries,
and explicit recovery for uncertain writes. A timeout is not treated as permission
to repeat an action.

## Technical Details

[Client setup](docs/CLIENT_INTEGRATIONS.md) &middot;
[Admin workspace](docs/ADMIN_WORKSPACE.md) &middot;
[Recovery design](docs/DURABLE_OPERATIONS.md) &middot;
[Connection diagnostics](docs/CONNECTION_DIAGNOSTICS.md) &middot;
[Run and test locally](docs/DEVELOPMENT.md)

[Edge source](src/index.js) &middot;
[Tool registry](src/tool-registry.js) &middot;
[Backend platform](https://github.com/YuqiGuo105/portfolio-ai-platform)

<sub>Real product screenshots; tool counts and client support vary by release.
[Image provenance](docs/screenshots/README.md).
This repository has no license file; the separate portfolio's MIT license does not apply automatically.</sub>

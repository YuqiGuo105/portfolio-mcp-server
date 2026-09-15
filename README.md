<p align="center">
  <img src="plugins/yuqi-portfolio/assets/icon.png" alt="Yuqi Portfolio" width="64" />
</p>
<h1 align="center">Portfolio MCP Gateway</h1>
<p align="center">
  <strong>Give AI clients useful context. Keep privileged actions under control.</strong>
</p>
<p align="center">
  A deployed integration connecting Claude and Codex to portfolio knowledge<br />
  and authenticated platform operations through the Model Context Protocol.
</p>
<p align="center">
  <a href="https://www.yuqi.site/mcp-guide"><strong>Connect a Client</strong></a> &middot;
  <a href="#public-edition">Public Edition</a> &middot;
  <a href="#administrator-edition">Administrator Edition</a> &middot;
  <a href="#architecture">Architecture</a> &middot;
  <a href="docs/DEVELOPMENT.md">Run Locally</a>
</p>

## Project at a Glance

AI integrations need more than access to APIs: they need reliable evidence,
clear permissions, and a way to recover when an action's outcome is uncertain.

Designed and delivered by **Yuqi Guo**, this gateway connects AI clients to a
multi-service platform through two distinct access paths: **public, read-only
discovery** and **authenticated administration**. The surrounding services
provide durable operation tracking and audit records, so an operator can inspect
what succeeded, what failed, and what needs reconciliation.

- **Evidence-backed discovery:** retrieve published projects, articles, profile facts, and architecture with source links.
- **Controlled execution:** validate tool arguments, enforce managed roles, and require approval for confirmation-gated writes.
- **Recoverable operations:** correlate requests with durable status and stable idempotency keys, without blindly retrying uncertain writes.

**Stack:** Node.js &middot; MCP SDK &middot; Zod &middot; OAuth/JWT &middot; Java/Spring backend services

## Public Edition

### Explore the work directly from an AI conversation

Ask Claude or Codex to find a project, explain its architecture, or retrieve
supporting articles. The public connector returns approved evidence and canonical
links, helping the client ground its answer in the actual portfolio.

> **Try it:** "Which project best demonstrates Yuqi's distributed-systems experience? Explain the design and link the evidence."

<p align="center">
  <a href="docs/screenshots/codex-public-plugin.png">
    <img src="docs/screenshots/codex-public-plugin.png" alt="Yuqi Portfolio plugin detail page in Codex with project, architecture, and technical writing prompts" width="640" />
  </a>
</p>
<p align="center"><sub>The public integration in Codex: projects, writing, architecture, and professional background.</sub></p>

**Connect:** add `https://www.yuqi.site/mcp` in a compatible MCP client.
No portfolio account is required. This endpoint exposes **read-only tools**,
not private resumes, administrator records, or privileged actions.

### Public connector in Claude

<p align="center">
  <a href="docs/screenshots/claude-public-connector.png">
    <img src="docs/screenshots/claude-public-connector.png" alt="Claude public connector showing read-only Yuqi Portfolio tool permissions" width="640" />
  </a>
</p>

Search projects and articles, retrieve profile and social links, inspect stored
architecture, or check the connection. Use live tool discovery for the current
catalog; the screenshot captures an earlier release.

[Client setup and Codex plugin installation](docs/CLIENT_INTEGRATIONS.md)

## Administrator Edition

### Investigate an issue, review an action, and follow its outcome

The protected connector extends the same conversational interface to platform
operations. Authorized administrators can inspect visitor activity, knowledge
records, delivery failures, and Chat Agent execution records, then use permitted
tools to manage content or recover supported operations.

**Administrator sign-in and a managed role are required.** Connect separately
to `https://www.yuqi.site/mcp/admin` and complete OAuth consent. A public
connection never becomes privileged simply because the user signs in elsewhere.

### Sign in, authorize, then operate

1. **Connect the admin endpoint** in your AI client and start its authentication flow.
2. **Sign in on yuqi.site** with an existing authorized account, using email and password or Google. Public registration is disabled; an existing session may skip this screen.
3. **Review and approve the connection** on the consent page, then return to your client. The server checks your managed role before exposing or executing permitted tools.

<p align="center">
  <a href="docs/screenshots/admin-sign-in.png">
    <img src="docs/screenshots/admin-sign-in.png" alt="Portfolio administrator sign-in page with email, password, and Google sign-in; public registration is disabled" width="480" />
  </a>
</p>
<p align="center"><sub>Administrator sign-in establishes identity. OAuth consent authorizes the connection; server-managed roles determine access.</sub></p>

**Signing in does not grant an administrator role.** Required write confirmations
remain in place after connection. Start authorization from the AI client rather
than reusing an old consent link.

### After authorization: administrator connector in Claude

<p align="center">
  <a href="docs/screenshots/claude-admin-connector.png">
    <img src="docs/screenshots/claude-admin-connector.png" alt="Authenticated administrator connector in Claude showing separate read and write tool permissions" width="640" />
  </a>
</p>
<p align="center"><sub>Claude after administrator authorization. Available tools depend on the managed role; screenshot counts are historical.</sub></p>

| Workflow | What the administrator can do |
| --- | --- |
| **Investigate** | Review visitor sessions, alert evidence, failed operations, and delivery status. |
| **Maintain** | Manage knowledge and content through validated, role-scoped tools. |
| **Debug** | Inspect Chat Agent questions, final answers, retrieval evidence, timings, and execution events. |
| **Recover** | Review current operation state and explicitly confirm supported retry actions. |

In MCP Apps-capable clients, the **admin workspace** presents timelines and
records interactively. Other clients receive text results and a protected console
link. Connection diagnostics explain tool-name and schema problems without
executing the sample operation.

[Admin workspace](docs/ADMIN_WORKSPACE.md) &middot;
[Connection diagnostics](docs/CONNECTION_DIAGNOSTICS.md)

## Engineering Decisions

| Challenge | Design decision | Why it matters |
| --- | --- | --- |
| **AI clients can send invalid or unauthorized requests.** | Schema validation and server-side RBAC apply to tool discovery and invocation. | Client prompts and approval preferences are not treated as authorization. |
| **A timeout does not prove that a write failed.** | Stable idempotency keys, persisted outcomes, and explicit uncertain-operation states. | Operators can reconcile state before risking duplicate downstream effects. |
| **One failing dependency should not exhaust the gateway.** | Internal adapters use circuit breakers, bulkheads, deadlines, and rate limits. | Failures are bounded and surfaced with recovery guidance. |
| **A multi-service failure is hard to reconstruct.** | Correlated operation transitions and structured audit records. | Requests can be traced across dispatch and follow-up investigation. |

Required approvals are enforced server-side. Unavailable authorization fails
closed. These controls support recovery; they do **not** imply global exactly-once
execution across every service.

[Read the durable operations and recovery contract](docs/DURABLE_OPERATIONS.md)

## Architecture

This repository owns the **stateless Node.js MCP edge**: client transport,
authentication, tool discovery, validation, and response sanitization.
The **internal Java gateway and domain services** own policy, durable dispatch,
and business data. Conversation persistence belongs to the AI Agent platform,
not the lifetime of an MCP connection.

<p align="center">
  <a href="docs/architecture/public-mcp-edge.svg">
    <img src="docs/architecture/public-mcp-edge.svg" alt="Architecture showing the MCP edge, separate public and admin access, internal gateway, domain services, and audit correlation" width="960" />
  </a>
</p>
<p align="center"><a href="docs/architecture/public-mcp-edge.svg"><strong>Explore the full-size architecture</strong></a></p>

**Read path:** client request &rarr; validated tool &rarr; approved evidence &rarr; sanitized result with source links.

**Write path:** authenticated request &rarr; role and schema checks &rarr; required confirmation &rarr; durable operation &rarr; owning service &rarr; observable status.

### Explore the Implementation

| Area | Code and documentation |
| --- | --- |
| **MCP transport and access** | [Server](src/index.js) &middot; [Authentication](src/admin-auth.js) &middot; [Tool registry](src/tool-registry.js) |
| **Backend integration** | [Gateway adapter](src/gateway-client.js) &middot; [Java AI platform](https://github.com/YuqiGuo105/portfolio-ai-platform) |
| **Operations and evidence** | [Event correlation](src/operation-events.js) &middot; [Recovery contract](docs/DURABLE_OPERATIONS.md) |
| **Setup and verification** | [Local development and tests](docs/DEVELOPMENT.md) &middot; [Client integrations](docs/CLIENT_INTEGRATIONS.md) |
| **Wider platform** | [Portfolio](https://github.com/YuqiGuo105/Portfolio) &middot; [Admin service](https://github.com/YuqiGuo105/portfolio-admin-service) &middot; [Analytics](https://github.com/YuqiGuo105/portfolio-analytics-platform) |

<details>
<summary><strong>Scope, screenshots, and licensing</strong></summary>

Client capabilities vary: remote MCP and embedded MCP Apps support depend on
the host application, not just the model provider. The screenshots are existing
product captures, not generated interfaces; see [provenance](docs/screenshots/README.md).

This repository does not currently include a license file. The main portfolio
repository's MIT license should not be assumed to apply to this separate repository.

</details>

# MCP Client Integrations

The portfolio exposes one public Streamable HTTP endpoint for AI clients:

```txt
https://www.yuqi.site/mcp
```

It is anonymous, read-only, bounded, and sanitized. The same protocol endpoint
works across model providers; the model is the client-side decision maker while
the MCP server remains the policy and data boundary.

## Codex

Install the complete plugin from this repository's marketplace:

```sh
codex plugin marketplace add YuqiGuo105/portfolio-mcp-server
codex plugin add yuqi-portfolio@yuqi-portfolio-platform
```

Start a new Codex thread after installation so the bundled skill and MCP tools
are loaded. To add only the MCP server without the plugin instructions:

```sh
codex mcp add yuqi-portfolio --url https://www.yuqi.site/mcp
codex mcp list
```

The repository marketplace is declared in
[`../.agents/plugins/marketplace.json`](../.agents/plugins/marketplace.json).
The plugin's `.codex-plugin/plugin.json` references the bundled `.mcp.json` and
skill; neither artifact contains credentials.

Official reference: [Codex MCP configuration](https://learn.chatgpt.com/docs/extend/mcp)

## ChatGPT

Create a custom MCP connector in ChatGPT developer mode and enter the public
endpoint. The public tools require no authentication. Keep the administrator
endpoint out of a public connector.

Official reference: [Build MCP servers for ChatGPT Apps](https://developers.openai.com/apps-sdk/build/mcp-server)

## Claude Code

Add the remote HTTP server for the current project:

```sh
claude mcp add --transport http yuqi-portfolio https://www.yuqi.site/mcp
claude mcp list
```

Use `--scope user` to make it available across local projects. A shareable
configuration is available at
[`client-configs/claude.mcp.json`](client-configs/claude.mcp.json).

Official reference: [Connect Claude Code to tools via MCP](https://docs.anthropic.com/en/docs/claude-code/mcp)

## GitHub Copilot in VS Code

Merge [`client-configs/vscode.mcp.json`](client-configs/vscode.mcp.json) into
`.vscode/mcp.json`, or use **MCP: Add Server** from the Command Palette. VS Code
uses the `servers` schema and supports remote HTTP servers.

For portable Agent Host configuration, place the equivalent server in a
workspace `.mcp.json` or user `~/.copilot/mcp-config.json` according to the
current Copilot host documentation.

Official reference: [VS Code MCP configuration](https://code.visualstudio.com/docs/agents/reference/mcp-configuration)

## Cursor

Copy [`client-configs/cursor.mcp.json`](client-configs/cursor.mcp.json) to
`.cursor/mcp.json` for a project or merge it into `~/.cursor/mcp.json` for all
projects. Cursor discovers the remote tools in both the editor and Cursor CLI.

Official reference: [Cursor MCP configuration](https://docs.cursor.com/context/model-context-protocol)

## Gemini CLI

Merge [`client-configs/gemini.settings.json`](client-configs/gemini.settings.json)
into `.gemini/settings.json` or `~/.gemini/settings.json`. `httpUrl` selects the
streaming HTTP transport; `trust: false` preserves per-call approval.

Official reference: [Gemini CLI MCP servers](https://geminicli.com/docs/tools/mcp-server/)

## Administrator tools

The privileged endpoint is `https://www.yuqi.site/mcp/admin`. It uses OAuth 2.1
with PKCE and Supabase Auth discovery, so compatible clients open the existing
yuqi.site administrator login and a dedicated consent screen. OAuth establishes
identity only; every request still resolves the managed administrator role and
permissions through the admin service. Risky writes remain confirmation-gated.

Add and authorize it in Codex without copying a bearer token:

```sh
codex mcp add yuqi-portfolio-admin \
  --url https://www.yuqi.site/mcp/admin \
  --oauth-client-registration dcr \
  --oauth-resource https://www.yuqi.site/mcp/admin
codex mcp login yuqi-portfolio-admin \
  --oauth-client-registration dcr \
  --scopes email,profile
```

The admin resource requests only the access-token scopes it uses. It does not
request `openid`, because the MCP resource server does not consume an OIDC ID
token; identity and managed admin authorization are resolved from the signed
Supabase access token.

The OAuth grant uses short-lived access tokens and refresh-token rotation. The
administrator can revoke the client grant from Supabase Auth. Do not add this
endpoint to the public plugin: administrator installation is intentionally an
explicit local action.

### Chat Agent diagnostics

After deploying the agent diagnostics endpoint and gateway catalog, an account
with the current `ADMIN` role can use:

- `agent.search_runs`: find a question, session, conversation, or run.
- `agent.get_run_diagnostics`: inspect a run's ordered events, source provenance,
  model/prompt versions, timings, safety outcomes, and missing-record signals.

These read-only tools are absent from the public endpoint and from Viewer,
Editor, and Publisher tool lists. The same restrictions apply to direct tool
calls, not just discovery. Each admin MCP HTTP request rechecks authorization;
login alone does not grant permission. An unavailable authorization service
fails closed. Diagnostics provide execution evidence and concise decision
summaries, not hidden model reasoning. Use them to investigate and test proposed
model or algorithm changes; they never modify production configuration.

Example request after administrator login: "Find the run for the travel question,
show which sources were retrieved and why the answer lacked evidence, then
suggest a regression test. Do not change production settings."

For an operator-run, read-only OAuth-to-database smoke test, use a real run UUID:

```sh
MCP_DIAGNOSTICS_RUN_ID=<run-uuid> node scripts/verify-agent-diagnostics.mjs
```

Open the printed authorization URL and approve the temporary verification client
as an administrator. The script checks the unauthenticated 401 response, tool
discovery, run search, and persisted diagnostics. Tokens stay in process memory;
it does not replay the agent or modify content. Revoke the verification client
grant in Supabase Auth when no longer needed.

## Verification

After installation, ask the client to list tools or run a read-only query such
as searching projects. A healthy public connection exposes six tools and never
exposes admin operations.

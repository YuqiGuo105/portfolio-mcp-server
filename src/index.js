/**
 * Portfolio MCP Server — Streamable HTTP transport.
 *
 * Exposes /mcp as the MCP endpoint for ChatGPT, Copilot, Claude, and Cursor.
 * All tools are read-only, no-auth, non-destructive.
 *
 * Exposes /mcp/admin as the authenticated admin MCP endpoint.
 * Requires Supabase JWT with admin email. Tools include write operations.
 *
 * Env:
 *   PORT                         (default 8080)
 *   MCP_GATEWAY_URL              (existing MCP Gateway)
 *   MCP_GATEWAY_INTERNAL_TOKEN   (shared secret for gateway auth)
 *   SUPABASE_JWT_SECRET          (for admin auth)
 *   ADMIN_ALLOWED_EMAILS         (comma-separated admin emails)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools } from './tools.js';
import { adminTools } from './admin-tools.js';
import { verifyAdminAuth, AuthError } from './admin-auth.js';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import { operationContext, recordToolCall } from './operation-events.js';
import {
  annotationsForTool,
  inputSchemaForTool,
  loadToolCatalog,
  requiresExplicitConfirmation,
  toolsForPrincipal,
} from './catalog-client.js';
import { invocationForTool, invokeGatewayTool } from './gateway-client.js';
import { invokeOwnerAdminTool, isOwnerAdminTool } from './owner-admin-client.js';
import {
  bearerChallenge,
  protectedResourceMetadata,
} from './oauth-resource.js';

const PORT = Number(process.env.PORT) || 8080;

// ── Create MCP Server ────────────────────────────────────────────────────

// ── Factory: create a fresh MCP server per request (stateless) ───────────

export function createServer(requestContext) {
  const srv = new McpServer({
    name: 'yuqi-portfolio',
    version: '1.0.0',
    description: "Yuqi Guo's Portfolio — search projects, articles, and professional profile",
  });

  for (const tool of tools) {
    srv.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.zodSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        const startedAt = Date.now();
        try {
          const result = await tool.handler(args);
          await recordToolCall({ context: requestContext, toolName: tool.name, status: 'completed', durationMs: Date.now() - startedAt });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          await recordToolCall({ context: requestContext, toolName: tool.name, status: 'failed', durationMs: Date.now() - startedAt, errorCode: err.name || 'ToolError' });
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            isError: true,
          };
        }
      }
    );
  }

  return srv;
}

// ── Factory: admin MCP server (authenticated, includes write tools) ──────

export async function createAdminServer(authContext, catalogLoader = loadToolCatalog) {
  authContext.actor = authContext.actor || `mcp-server:admin:${authContext.email}`;
  const requestContext = authContext.operationContext;
  const srv = new McpServer({
    name: 'yuqi-portfolio-admin',
    version: '1.0.0',
    description: "Yuqi Guo's Portfolio Admin — manage alert rules (authenticated)",
  });

  // Include public read tools
  for (const tool of tools) {
    srv.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.zodSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        const startedAt = Date.now();
        try {
          const result = await tool.handler(args, authContext);
          await recordToolCall({ context: requestContext, toolName: tool.name, status: 'completed', durationMs: Date.now() - startedAt });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          await recordToolCall({ context: requestContext, toolName: tool.name, status: 'failed', durationMs: Date.now() - startedAt, errorCode: err.name || 'ToolError' });
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            isError: true,
          };
        }
      }
    );
  }

  // Admin-only tools
  for (const tool of adminTools) {
    srv.registerTool(
      tool.name,
      {
        description: tool.description,
        inputSchema: tool.zodSchema,
        annotations: tool.annotations,
      },
      async (args) => {
        const startedAt = Date.now();
        try {
          const result = await tool.handler(args, authContext);
          await recordToolCall({ context: requestContext, toolName: tool.name, status: 'completed', durationMs: Date.now() - startedAt });
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
          await recordToolCall({ context: requestContext, toolName: tool.name, status: 'failed', durationMs: Date.now() - startedAt, errorCode: err.name || 'ToolError' });
          return {
            content: [{ type: 'text', text: JSON.stringify({ error: err.message }) }],
            isError: true,
          };
        }
      }
    );
  }

  const catalog = toolsForPrincipal(await catalogLoader(), authContext);
  for (const tool of catalog) {
    srv.registerTool(
      tool.name,
      {
        description: `${tool.description} [${tool.mode}; risk=${tool.riskLevel}; role=${tool.requiredRole}]`,
        inputSchema: inputSchemaForTool(tool),
        annotations: annotationsForTool(tool),
      },
      async (rawArgs) => executeCatalogTool(tool, rawArgs, authContext, requestContext)
    );
  }

  return srv;
}

async function executeCatalogTool(tool, rawArgs, authContext, requestContext) {
  const startedAt = Date.now();
  try {
    if (requiresExplicitConfirmation(tool, rawArgs)) {
      throw new Error('Explicit user confirmation is required before this operation can run');
    }
    const { args, context } = invocationForTool(tool, rawArgs, authContext);
    const result = isOwnerAdminTool(tool.name)
      ? await invokeOwnerAdminTool(tool.name, stripControlArguments(args), authContext)
      : await invokeGatewayTool(tool.name, args, context);
    await recordToolCall({
      context: requestContext,
      toolName: tool.name,
      status: 'completed',
      durationMs: Date.now() - startedAt,
    });
    return toolResult(result);
  } catch (error) {
    await recordToolCall({
      context: requestContext,
      toolName: tool.name,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      errorCode: error.name || 'ToolError',
    });
    return toolError(error);
  }
}

function stripControlArguments(args) {
  const result = { ...args };
  delete result._confirmed;
  delete result._confirmedTimeRange;
  return result;
}

function toolResult(result) {
  return {
    content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
    ...(result && typeof result === 'object' && !Array.isArray(result)
      ? { structuredContent: result }
      : {}),
  };
}

function toolError(error) {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: error.message }) }],
    isError: true,
  };
}

// ── HTTP Server with Streamable HTTP Transport ───────────────────────────

export function createHttpServer() {
  return http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'yuqi-portfolio-mcp', version: '1.0.0' }));
    return;
  }

  if (
    url.pathname === '/.well-known/oauth-protected-resource' ||
    url.pathname === '/.well-known/oauth-protected-resource/mcp/admin'
  ) {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=300',
    });
    res.end(JSON.stringify(protectedResourceMetadata()));
    return;
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    try {
      const srv = createServer(operationContext(req));
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless
      });
      await srv.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      console.error('MCP request error:', err.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Internal server error' }));
      }
    }
    return;
  }

  // Admin MCP endpoint (authenticated)
  if (url.pathname === '/mcp/admin') {
    try {
      const authHeader = req.headers['authorization'] || null;
      const authContext = await verifyAdminAuth(authHeader);
      authContext.operationContext = operationContext(req, `mcp-server:admin:${authContext.email || 'unknown'}`);
      const srv = await createAdminServer(authContext);
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined, // Stateless
      });
      await srv.connect(transport);
      await transport.handleRequest(req, res);
    } catch (err) {
      if (err instanceof AuthError) {
        const headers = { 'Content-Type': 'application/json' };
        if (err.statusCode === 401) {
          headers['WWW-Authenticate'] = bearerChallenge();
        }
        res.writeHead(err.statusCode, headers);
        res.end(JSON.stringify({ error: err.message }));
      } else {
        console.error('Admin MCP request error:', err.message);
        if (!res.headersSent) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Internal server error' }));
        }
      }
    }
    return;
  }

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol.' }));
  });
}

const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  const httpServer = createHttpServer();
  httpServer.listen(PORT, () => {
    console.log(`Portfolio MCP Server listening on port ${PORT}`);
    console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
    console.log(`Admin MCP endpoint: http://localhost:${PORT}/mcp/admin (OAuth bearer token required)`);
    console.log(`Health: http://localhost:${PORT}/health`);
    console.log(`Public tools: ${tools.map(t => t.name).join(', ')}`);
    console.log('Admin tools: canonical gateway catalog + compatibility aliases');
  });
}

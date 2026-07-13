/**
 * Portfolio MCP Server — Streamable HTTP transport.
 *
 * Exposes /mcp as the MCP endpoint for ChatGPT, Copilot, Claude, and Cursor.
 * All tools are read-only, no-auth, non-destructive.
 *
 * Env:
 *   PORT                         (default 8080)
 *   MCP_GATEWAY_URL              (existing MCP Gateway)
 *   MCP_GATEWAY_INTERNAL_TOKEN   (shared secret for gateway auth)
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { tools } from './tools.js';
import { z } from 'zod';
import http from 'node:http';

const PORT = Number(process.env.PORT) || 8080;

// ── Create MCP Server ────────────────────────────────────────────────────

// ── Factory: create a fresh MCP server per request (stateless) ───────────

function createServer() {
  const srv = new McpServer({
    name: 'yuqi-portfolio',
    version: '1.0.0',
    description: "Yuqi Guo's Portfolio — search projects, articles, and professional profile",
  });

  for (const tool of tools) {
    srv.tool(
      tool.name,
      tool.description,
      tool.zodSchema,
      async (args) => {
        try {
          const result = await tool.handler(args);
          return {
            content: [{ type: 'text', text: JSON.stringify(result, null, 2) }],
          };
        } catch (err) {
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

// ── HTTP Server with Streamable HTTP Transport ───────────────────────────

const httpServer = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  // Health check
  if (url.pathname === '/health' || url.pathname === '/') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok', server: 'yuqi-portfolio-mcp', version: '1.0.0' }));
    return;
  }

  // MCP endpoint
  if (url.pathname === '/mcp') {
    try {
      const srv = createServer();
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

  // 404
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'Not found. Use /mcp for MCP protocol.' }));
});

httpServer.listen(PORT, () => {
  console.log(`Portfolio MCP Server listening on port ${PORT}`);
  console.log(`MCP endpoint: http://localhost:${PORT}/mcp`);
  console.log(`Health: http://localhost:${PORT}/health`);
  console.log(`Tools registered: ${tools.map(t => t.name).join(', ')}`);
});

/**
 * Internal HTTP client → existing MCP Gateway (portfolio-mcp-gateway).
 * Only calls read-only, public-safe tool endpoints.
 */

const GATEWAY_URL = (process.env.MCP_GATEWAY_URL || 'https://portfolio-mcp-gateway-702193211434.us-central1.run.app').replace(/\/+$/, '');
const GATEWAY_TOKEN = process.env.MCP_GATEWAY_INTERNAL_TOKEN || '';
const TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS) || 10_000;

export async function invokeGatewayTool(toolName, args, context) {
  const url = `${GATEWAY_URL}/api/tools/${encodeURIComponent(toolName)}/invoke`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    'X-Actor': context?.actor || 'mcp-server:public',
  };
  if (context?.role) {
    headers['X-Role'] = context.role;
  }
  if (context?.idempotencyKey) {
    headers['Idempotency-Key'] = context.idempotencyKey;
  }

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(args),
      signal: controller.signal,
    });

    const body = await res.text();
    if (!res.ok) {
      const err = safeParseJson(body);
      throw new Error(err?.message || `Gateway ${res.status}: ${body.slice(0, 200)}`);
    }
    return safeParseJson(body) ?? body;
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

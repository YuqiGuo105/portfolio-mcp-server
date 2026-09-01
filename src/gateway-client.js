/**
 * Internal HTTP client → existing MCP Gateway (portfolio-mcp-gateway).
 * Calls the canonical internal tool gateway. Public/admin exposure is decided
 * by the MCP endpoint before this client is invoked.
 */

import { randomUUID } from 'node:crypto';

const GATEWAY_URL = (process.env.MCP_GATEWAY_URL || 'https://portfolio-mcp-gateway-702193211434.us-central1.run.app').replace(/\/+$/, '');
const GATEWAY_TOKEN = process.env.MCP_GATEWAY_INTERNAL_TOKEN || '';
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_CAREER_TIMEOUT_MS = 30_000;

export async function invokeGatewayTool(toolName, args, context, options = {}) {
  const url = `${GATEWAY_URL}/api/tools/${encodeURIComponent(toolName)}/invoke`;
  const timeoutMs = options.timeoutMs || gatewayTimeoutForTool(toolName);
  const fetchImpl = options.fetchImpl || fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  const headers = {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${GATEWAY_TOKEN}`,
    'X-Actor': context?.actor || 'mcp-server:public',
  };
  if (context?.role) {
    headers['X-Role'] = context.role;
  }
  const idempotencyKey = context?.idempotencyKey || args?._idempotencyKey;
  if (idempotencyKey) {
    headers['Idempotency-Key'] = idempotencyKey;
  }

  try {
    const res = await fetchImpl(url, {
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
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new Error(`${toolName} gateway timed out after ${timeoutMs}ms`, { cause: error });
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function gatewayTimeoutForTool(toolName, env = process.env) {
  if (String(toolName).startsWith('career.')) {
    return positiveNumber(env.CAREER_GATEWAY_TIMEOUT_MS, DEFAULT_CAREER_TIMEOUT_MS);
  }
  return positiveNumber(env.GATEWAY_TIMEOUT_MS, DEFAULT_TIMEOUT_MS);
}

export function invocationForTool(tool, rawArgs, authContext) {
  const args = { ...(rawArgs || {}) };
  const suppliedIdempotencyKey = args._idempotencyKey;
  delete args._idempotencyKey;
  return {
    args,
    context: {
      actor: `mcp-server:admin:${authContext.email}`,
      role: authContext.role,
      idempotencyKey: tool.mode === 'WRITE'
        ? suppliedIdempotencyKey || randomUUID()
        : undefined,
    },
  };
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

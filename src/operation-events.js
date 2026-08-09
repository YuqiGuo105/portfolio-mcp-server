import { randomUUID } from 'node:crypto';

const ADMIN_SERVICE_URL = (process.env.ADMIN_SERVICE_URL || '').replace(/\/+$/, '');
const ADMIN_SERVICE_TOKEN = process.env.ADMIN_SERVICE_INTERNAL_TOKEN || '';
const TIMEOUT_MS = Number(process.env.OPERATION_EVENT_TIMEOUT_MS) || 750;

export function operationContext(req, actor = 'mcp-server:public') {
  const traceparent = String(req.headers.traceparent || '');
  const parts = traceparent.split('-');
  const traceId = parts.length >= 4 && /^[a-f0-9]{32}$/i.test(parts[1])
    ? parts[1]
    : randomUUID().replaceAll('-', '');
  const correlationId = String(req.headers['x-correlation-id'] || req.headers['x-request-id'] || traceId);
  return { traceId, correlationId, actor };
}

export async function recordToolCall({ context, toolName, status, durationMs, errorCode }) {
  if (!ADMIN_SERVICE_URL || !ADMIN_SERVICE_TOKEN) return;
  const eventId = randomUUID();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  const event = {
    eventId,
    eventType: status === 'failed' ? 'mcp.tool.failed' : 'mcp.tool.completed',
    schemaVersion: 1,
    occurredAt: new Date().toISOString(),
    environment: process.env.NODE_ENV || 'production',
    traceId: context.traceId,
    runId: null,
    correlationId: context.correlationId,
    causationId: null,
    idempotencyKey: `${context.correlationId}:${toolName}`,
    actor: { type: context.actor.startsWith('mcp-server:admin') ? 'USER' : 'SERVICE', id: context.actor },
    subject: { type: 'mcp_tool', id: toolName, version: null },
    sourceService: 'portfolio-mcp-server',
    status,
    attempt: 1,
    durationMs,
    attributes: errorCode ? { toolName, errorCode } : { toolName },
  };
  try {
    await fetch(`${ADMIN_SERVICE_URL}/api/admin/operations/timeline/events`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': ADMIN_SERVICE_TOKEN,
        'X-Correlation-Id': context.correlationId,
        traceparent: `00-${context.traceId}-${randomUUID().replaceAll('-', '').slice(0, 16)}-01`,
      },
      body: JSON.stringify(event),
      signal: controller.signal,
    });
  } catch {
    // Observability is deliberately fail-open for the public MCP edge.
  } finally {
    clearTimeout(timer);
  }
}

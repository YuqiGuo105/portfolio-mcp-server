/**
 * Internal HTTP client → existing MCP Gateway (portfolio-mcp-gateway).
 * Calls the canonical internal tool gateway. Public/admin exposure is decided
 * by the MCP endpoint before this client is invoked.
 */

const GATEWAY_URL = (process.env.MCP_GATEWAY_URL || 'https://portfolio-mcp-gateway-702193211434.us-central1.run.app').replace(/\/+$/, '');
const GATEWAY_TOKEN = process.env.MCP_GATEWAY_INTERNAL_TOKEN || '';
const DEFAULT_TIMEOUT_MS = 40_000;
const DEFAULT_CAREER_TIMEOUT_MS = 50_000;

export class GatewayError extends Error {
  constructor(message, details) { super(message); this.name = 'GatewayError'; this.details = details; }
}

export async function invokeGatewayTool(toolName, args, context, options = {}) {
  const url = `${GATEWAY_URL}${options.endpointPath || `/api/tools/${encodeURIComponent(toolName)}/invoke`}`;
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
      throw new GatewayError(err?.message || err?.code || `Gateway returned HTTP ${res.status}`, {
        ...(err && typeof err === 'object' ? err : {}), httpStatus: res.status,
        idempotencyKey, tool: toolName,
      });
    }
    return safeParseJson(body) ?? body;
  } catch (error) {
    if (controller.signal.aborted || error?.name === 'AbortError') {
      throw new GatewayError(`${toolName} gateway timed out after ${timeoutMs}ms`, {
        code: 'gateway_timeout', idempotencyKey, tool: toolName,
        ambiguousOutcome: Boolean(idempotencyKey), safeToRetry: !idempotencyKey,
        retryable: !idempotencyKey, nextAction: idempotencyKey ? 'QUERY_OPERATION_LIST_BEFORE_RETRY' : 'RETRY_WITH_BACKOFF',
      });
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
  if (tool.mode === 'WRITE' && (typeof suppliedIdempotencyKey !== 'string' || suppliedIdempotencyKey.length < 8 || suppliedIdempotencyKey.length > 200)) {
    throw new GatewayError('A stable _idempotencyKey is required for write operations.', {
      code: 'idempotency_key_required', safeToRetry: true, ambiguousOutcome: false,
    });
  }
  return {
    args,
    context: {
      actor: `mcp-server:admin:${authContext.email}`,
      role: authContext.role,
      idempotencyKey: tool.mode === 'WRITE'
        ? suppliedIdempotencyKey
        : undefined,
    },
  };
}

export async function invokeOwnerWrite(toolName,args,context,handler) {
  const path=`/api/owner-operations/${encodeURIComponent(toolName)}`;
  const claim=await invokeGatewayTool(toolName,args,context,{endpointPath:`${path}/claim`});
  if(!claim.dispatch) {
    const {response,dispatch,leaseToken,...operation}=claim;
    if(claim.state==='SUCCEEDED') return {...response,operation};
    throw new GatewayError('Owner operation has an existing outcome. Inspect status before retrying.',{operation});
  }
  try {
    const response=await handler();
    const operation=await invokeGatewayTool(toolName,{claim,state:'SUCCEEDED',httpStatus:200,response},context,{endpointPath:`${path}/complete`});
    return {...response,operation};
  } catch(error) {
    let operation={operationId:claim.operationId,state:'UNKNOWN',safeToRetry:false,ambiguousOutcome:true};
    try {
      operation=await invokeGatewayTool(toolName,{claim,state:'UNKNOWN',httpStatus:502,response:{code:'owner_operation_failed'}},context,{endpointPath:`${path}/complete`});
    } catch { /* Admission remains durable if completion cannot be recorded. */ }
    throw new GatewayError('Owner operation outcome needs verification.',{operation});
  }
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

function positiveNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

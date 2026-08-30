import { z } from 'zod';

const DEFAULT_GATEWAY_URL = 'https://portfolio-mcp-gateway-702193211434.us-central1.run.app';
const CACHE_TTL_MS = Number(process.env.TOOL_CATALOG_CACHE_TTL_MS) || 60_000;
const MAX_STALE_MS = Number(process.env.TOOL_CATALOG_MAX_STALE_MS) || 15 * 60_000;
const TIMEOUT_MS = Number(process.env.GATEWAY_TIMEOUT_MS) || 10_000;

const ROLE_RANK = Object.freeze({
  VIEWER: 0,
  EDITOR: 1,
  PUBLISHER: 2,
  ADMIN: 3,
});

const OWNER_ONLY_TOOLS = new Set([
  'admin.list_admin_users',
  'admin.upsert_admin_user',
  'admin.update_admin_user_status',
]);

let cachedCatalog = null;
let cachedAt = 0;

export async function loadToolCatalog({ force = false, fetchImpl = fetch } = {}) {
  const now = Date.now();
  if (!force && cachedCatalog && now - cachedAt < CACHE_TTL_MS) return cachedCatalog;

  const gatewayUrl = (process.env.MCP_GATEWAY_URL || DEFAULT_GATEWAY_URL).replace(/\/+$/, '');
  const gatewayToken = process.env.MCP_GATEWAY_INTERNAL_TOKEN || '';
  if (!gatewayToken) throw new Error('MCP_GATEWAY_INTERNAL_TOKEN not configured');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(`${gatewayUrl}/api/tools`, {
      headers: { Authorization: `Bearer ${gatewayToken}` },
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(`Tool catalog unavailable (${response.status})`);
    const parsed = JSON.parse(text);
    if (!Array.isArray(parsed)) throw new Error('Tool catalog response must be an array');
    cachedCatalog = parsed.map(normalizeToolDefinition).filter(Boolean);
    cachedAt = now;
    return cachedCatalog;
  } catch (error) {
    if (cachedCatalog && now - cachedAt <= MAX_STALE_MS) return cachedCatalog;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

export function toolsForPrincipal(catalog, principal) {
  const actualRank = ROLE_RANK[String(principal?.role || '').toUpperCase()] ?? -1;
  return catalog.filter((tool) => {
    const requiredRank = ROLE_RANK[tool.requiredRole] ?? Number.MAX_SAFE_INTEGER;
    if (actualRank < requiredRank) return false;
    return !OWNER_ONLY_TOOLS.has(tool.name) || principal?.owner === true;
  });
}

export function inputSchemaForTool(tool) {
  const shape = {};
  for (const parameter of tool.parameters) {
    let schema = schemaForType(parameter.type);
    if (parameter.type === 'string') {
      if (Number.isInteger(parameter.minLength)) schema = schema.min(parameter.minLength);
      if (Number.isInteger(parameter.maxLength)) schema = schema.max(parameter.maxLength);
    }
    if (parameter.description) schema = schema.describe(parameter.description);
    if (!parameter.required) schema = schema.optional();
    shape[parameter.name] = schema;
  }

  if (tool.confirmRequired) {
    shape._confirmed = z.boolean().optional().describe(
      'Set true only after the user explicitly approves this exact write operation.'
    );
  }
  if (tool.name.startsWith('analytics.')) {
    shape._confirmedTimeRange = z.boolean().optional().describe(
      'Confirms that the requested analytics time range was explicitly selected.'
    );
  }
  if (tool.mode === 'WRITE') {
    shape._idempotencyKey = z.string().min(8).max(200).optional().describe(
      'Optional caller-supplied idempotency key. The server generates one when omitted.'
    );
  }
  return shape;
}

export function annotationsForTool(tool) {
  const isWrite = tool.mode === 'WRITE';
  return {
    readOnlyHint: !isWrite,
    destructiveHint: isWrite && (tool.confirmRequired || ['HIGH', 'CRITICAL'].includes(tool.riskLevel)),
    idempotentHint: isWrite,
    openWorldHint: tool.name === 'contact.email_owner' || tool.name === 'notification.send_test_notification',
  };
}

export function requiresExplicitConfirmation(tool, args = {}) {
  if (!tool.confirmRequired) return false;
  if (tool.confirmationMethod === 'email_otp') return false;
  if (tool.dryRunSupported && args.dryRun === true) return false;
  return args._confirmed !== true;
}

export function resetCatalogCacheForTest() {
  cachedCatalog = null;
  cachedAt = 0;
}

function normalizeToolDefinition(raw) {
  if (!raw || typeof raw.name !== 'string' || !/^[A-Za-z0-9._-]{1,128}$/.test(raw.name)) {
    return null;
  }
  return Object.freeze({
    name: raw.name,
    mode: String(raw.mode || 'READ').toUpperCase(),
    description: String(raw.description || raw.name),
    requiredRole: String(raw.requiredRole || 'ADMIN').toUpperCase(),
    riskLevel: String(raw.riskLevel || 'LOW').toUpperCase(),
    dryRunSupported: raw.dryRunSupported === true,
    confirmRequired: raw.confirmRequired === true,
    confirmationMethod: String(raw.confirmationMethod || '').toLowerCase(),
    parameters: Array.isArray(raw.parameters)
      ? raw.parameters.filter((item) => item && typeof item.name === 'string').map((item) => ({
          name: item.name,
          type: String(item.type || 'string').toLowerCase(),
          required: item.required === true,
          description: item.description ? String(item.description) : '',
          minLength: Number.isInteger(item.minLength) ? item.minLength : null,
          maxLength: Number.isInteger(item.maxLength) ? item.maxLength : null,
        }))
      : [],
  });
}

function schemaForType(type) {
  switch (type) {
    case 'integer': return z.number().int();
    case 'number': return z.number();
    case 'boolean': return z.boolean();
    case 'array': return z.array(z.unknown());
    case 'object': return z.record(z.string(), z.unknown());
    default: return z.string();
  }
}

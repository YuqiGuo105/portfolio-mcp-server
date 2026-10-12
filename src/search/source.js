import { invokeGatewayTool } from '../gateway-client.js';
import { recordPhase } from '../tool-timings.js';

// Full-text projection is separate from normal MCP content lists to keep model
// contexts small. The internal service credential authenticates these reads.
export async function readSearchSource(toolName, args, context, options = {}) {
  const base = process.env.ADMIN_SERVICE_URL?.replace(/\/+$/, '');
  const token = process.env.SEARCH_PROJECTION_ADMIN_SECRET;
  if (!base || !token) return invokeGatewayTool(toolName, args, context, options);
  const url = new URL(`${base}/api/admin/content/search-projection`);
  url.searchParams.set('type', args.sourceType);
  url.searchParams.set('limit', String(args.limit));
  const controller = new AbortController();
  const timeoutMs = options.timeoutMs || 8000;
  const started = Date.now();
  const startedAt = performance.now();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers: { 'X-Admin-Secret': token },
      redirect: 'error', cache: 'no-store', signal: controller.signal });
    if (response.status === 404) {
      // Rolling upgrade: old service supports only the explicit metadata path.
      const remaining = timeoutMs - (Date.now() - started);
      if (remaining <= 0) throw new Error('Search projection timed out');
      return await invokeGatewayTool(toolName, args, context, { ...options, timeoutMs: remaining });
    }
    if (!response.ok) throw new Error(`Search projection unavailable (${response.status})`);
    return await response.json();
  } finally {
    clearTimeout(timer);
    recordPhase('projection', startedAt, { sourceType: args.sourceType });
  }
}

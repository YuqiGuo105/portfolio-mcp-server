const OWNER_TOOL_NAMES = new Set([
  'admin.list_admin_users',
  'admin.upsert_admin_user',
  'admin.update_admin_user_status',
]);

export function isOwnerAdminTool(toolName) {
  return OWNER_TOOL_NAMES.has(toolName);
}

export async function invokeOwnerAdminTool(toolName, args, authContext) {
  if (!authContext?.owner || !authContext?.accessToken) {
    throw new Error('Owner permission required');
  }
  const baseUrl = (process.env.ADMIN_SERVICE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) throw new Error('ADMIN_SERVICE_URL not configured');

  let path;
  let method;
  let body;
  if (toolName === 'admin.list_admin_users') {
    const query = new URLSearchParams();
    for (const key of ['status', 'role', 'limit', 'offset']) {
      if (args[key] !== undefined) query.set(key, String(args[key]));
    }
    path = `/api/admin/users${query.size ? `?${query}` : ''}`;
    method = 'GET';
  } else if (toolName === 'admin.upsert_admin_user') {
    path = '/api/admin/users';
    method = 'POST';
    body = args;
  } else if (toolName === 'admin.update_admin_user_status') {
    path = `/api/admin/users/${encodeURIComponent(args.userId)}/status`;
    method = 'PATCH';
    body = { status: args.status, note: args.note };
  } else {
    throw new Error(`Unsupported owner tool: ${toolName}`);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), Number(process.env.ADMIN_TOOL_TIMEOUT_MS) || 10_000);
  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${authContext.accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
    const text = await response.text();
    const result = safeParseJson(text) ?? text;
    if (!response.ok) {
      throw new Error(result?.message || `Admin service rejected operation (${response.status})`);
    }
    return result;
  } finally {
    clearTimeout(timer);
  }
}

function safeParseJson(text) {
  try { return JSON.parse(text); } catch { return null; }
}

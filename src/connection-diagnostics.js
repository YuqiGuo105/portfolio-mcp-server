import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { SUPPORTED_PROTOCOL_VERSIONS } from '@modelcontextprotocol/sdk/types.js';
import { discoverAuthorizationServerMetadata } from '@modelcontextprotocol/sdk/client/auth.js';
import { authorizationServerIssuer, protectedResourceMetadata, bearerChallenge } from './oauth-resource.js';
import { publishedSchema, schemaHash, registryFor } from './tool-registry.js';
import { recordToolCall } from './operation-events.js';

export const CONNECTION_INPUT = {
  locale: z.enum(['en', 'zh']).default('en'),
  client: z.object({
    protocolVersion: z.string().max(32).optional(),
    schemaDialect: z.enum(['draft-7', 'draft-2020-12']).optional(),
    supportsMcpApps: z.boolean().optional(),
    observedFailure: z.object({ phase: z.enum(['registration', 'refresh', 'tool_call', 'handshake']),
      httpStatus: z.number().int().min(400).max(599).optional() }).strict().optional(),
  }).strict().optional(),
  invocations: z.array(z.object({
    name: z.string().min(1).max(160),
    arguments: z.record(z.string(), z.unknown()).optional(),
    schemaHash: z.string().regex(/^[a-f0-9]{64}$/i).optional(),
  }).strict()).max(10).default([]),
};
const INPUT = z.object(CONNECTION_INPUT).strict();
const safeText = value => /^[\w.\[\]-]{1,160}$/.test(String(value)) ? String(value) : '[field]';
const pair = (locale, en, zh) => locale === 'zh' ? zh : en;
const https = value => { try { const u = new URL(value); return u.protocol === 'https:' && !u.username && !u.password && !u.hash; } catch { return false; } };

export function createOAuthProbe({ fetchImpl = fetch, now = Date.now, timeoutMs = 5000 } = {}) {
  let cached;
  return async issuer => {
    if (!https(issuer)) return { status: 'fail', code: 'oauth_not_configured', observedAt: new Date(now()).toISOString() };
    if (cached?.issuer === issuer && cached.expires > now()) return cached.promise;
    const promise = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const origin = new URL(issuer).origin;
        const boundedFetch = async (url, init) => {
          if (new URL(url).origin !== origin) throw new Error('Untrusted discovery origin');
          const response = await fetchImpl(url, { ...init, redirect: 'manual', signal: controller.signal });
          if (!response.ok) { await response.body?.cancel(); return new Response(null, { status: response.status }); }
          if (!/application\/(?:[\w.+-]*\+)?json/i.test(response.headers.get('content-type') || '')) throw new Error('Invalid metadata format');
          const reader = response.body.getReader(); const chunks = []; let size = 0;
          try {
            for (;;) { const { done, value } = await reader.read(); if (done) break; size += value.length; if (size > 65536) throw new Error('Metadata too large'); chunks.push(Buffer.from(value)); }
          } finally { await reader.cancel(); }
          return new Response(Buffer.concat(chunks), { status: 200, headers: { 'Content-Type': 'application/json' } });
        };
        const metadata = await discoverAuthorizationServerMetadata(issuer, { fetchFn: boundedFetch });
        if (!metadata || metadata.issuer !== issuer || !https(metadata.authorization_endpoint) || !https(metadata.token_endpoint)) {
          return { status: 'fail', code: 'oauth_metadata_invalid' };
        }
        if (!metadata.code_challenge_methods_supported?.includes('S256')) return { status: 'fail', code: 'pkce_s256_missing' };
        return { status: 'pass', code: 'oauth_discovery_ready', registrationAdvertised: https(metadata.registration_endpoint),
          clientMetadataAdvertised: metadata.client_id_metadata_document_supported === true };
      } catch { return { status: 'fail', code: controller.signal.aborted ? 'oauth_discovery_timeout' : 'oauth_discovery_unavailable' }; }
      finally { clearTimeout(timer); }
    })().then(result => ({ ...result, observedAt: new Date(now()).toISOString() }));
    cached = { issuer, expires: now() + 60000, promise };
    return promise;
  };
}
const defaultProbe = createOAuthProbe();

export async function diagnoseConnection(input, { surface = 'public', principal, authError, registry,
  catalogAvailable = true, probe = defaultProbe, now = Date.now } = {}) {
  const { locale, client = {}, invocations } = INPUT.parse(input);
  if (Buffer.byteLength(JSON.stringify(invocations)) > 16384) throw new Error('Invocation samples exceed 16 KiB');
  const checks = [];
  const add = (id, status, code, en, zh, action, evidence) => checks.push({ id, status, code,
    message: pair(locale, en, zh), ...(action ? { nextAction: action } : {}), ...(evidence ? { evidence } : {}) });
  add('transport', 'pass', 'edge_reached', 'The MCP service received this request. Client-side browser behavior has not been verified.',
    'MCP 服务已收到请求；这不代表客户端浏览器行为也已验证。');
  if (surface === 'admin') {
    const code = authError?.code || (principal ? 'session_valid' : 'session_required');
    if (principal) {
      const remaining = Math.max(0, Math.floor((principal.expiresAt * 1000 - now()) / 1000));
      add('session', remaining < 300 ? 'warn' : 'pass', remaining < 300 ? 'session_expiring' : code,
        remaining < 300 ? 'The verified session expires soon. Refresh it in your client.' : 'Session signature and managed role were verified.',
        remaining < 300 ? '已验证的会话即将过期，请在客户端刷新。' : '会话签名与服务端管理的权限已验证。',
        remaining < 300 ? 'REFRESH_SESSION' : undefined, { role: principal.role, expiresInSeconds: Number.isFinite(remaining) ? remaining : null });
    } else {
      const expired = code === 'session_expired';
      const unavailable = ['auth_service_unavailable', 'auth_verifier_unavailable', 'auth_configuration_error'].includes(code);
      add('session', 'fail', code,
        expired ? 'The session has expired. Reconnect or refresh in the client.' : unavailable ? 'Authentication could not be verified because the service is unavailable.' : 'A valid, authorized administrator session is required.',
        expired ? '会话已过期，请在客户端刷新或重新连接。' : unavailable ? '认证服务暂不可用，无法验证权限。' : '需要有效且已授权的管理员会话。',
        unavailable ? 'RETRY_LATER' : code === 'admin_access_denied' ? 'CONTACT_ADMINISTRATOR' : 'RECONNECT_OAUTH');
    }
    const metadata = protectedResourceMetadata();
    const validConfig = https(metadata.resource) && https(metadata.authorization_servers?.[0]);
    add('oauth_configuration', validConfig ? 'pass' : 'fail', validConfig ? 'oauth_configured' : 'oauth_not_configured',
      validConfig ? 'Protected-resource metadata advertises an HTTPS issuer and resource.' : 'OAuth resource or issuer configuration is missing or invalid.',
      validConfig ? '受保护资源元数据已配置 HTTPS 签发者与资源地址。' : 'OAuth 资源或签发者配置缺失或无效。', validConfig ? undefined : 'CHECK_SERVER_CONFIGURATION');
    if (validConfig) {
      const result = await probe(authorizationServerIssuer());
      add('oauth_discovery', result.status, result.code,
        result.status === 'pass' ? 'Authorization metadata and PKCE S256 are available. Registration and browser consent were not executed.' : 'OAuth metadata discovery or PKCE validation failed. This is not proof that the user session expired.',
        result.status === 'pass' ? '授权元数据与 PKCE S256 可用；未执行客户端注册或浏览器授权。' : 'OAuth 元数据发现或 PKCE 验证失败；不等同于用户会话过期。',
        result.status === 'pass' ? undefined : 'CHECK_OAUTH_DISCOVERY', { observedAt: result.observedAt });
      if (result.status === 'pass') add('client_registration', result.registrationAdvertised || result.clientMetadataAdvertised ? 'pass' : 'warn',
        'registration_capabilities', 'Registration capabilities were inspected, not exercised. Use a pre-registered Client ID when automatic registration is unavailable.',
        '已检查注册能力声明，但未实际注册。自动注册不可用时，请配置预注册的 Client ID。',
        result.registrationAdvertised || result.clientMetadataAdvertised ? undefined : 'CONFIGURE_CLIENT_ID',
        { dynamicRegistrationAdvertised: result.registrationAdvertised, clientMetadataAdvertised: result.clientMetadataAdvertised });
    }
  } else add('session', 'pass', 'public_no_auth', 'This public endpoint does not require login.', '公开端无需登录。');

  const canInspect = surface === 'public' || Boolean(principal);
  const entries = canInspect && catalogAvailable ? registry.entries() : [];
  add('catalog', !canInspect ? 'skip' : catalogAvailable ? 'pass' : 'fail', !canInspect ? 'catalog_not_inspected' : catalogAvailable ? 'catalog_ready' : 'catalog_unavailable',
    !canInspect ? 'Private tool discovery is withheld until authentication succeeds.' : catalogAvailable ? 'Inspecting this connection\'s current registered tools.' : 'The upstream tool catalog is unavailable. Do not treat missing tools as removed.',
    !canInspect ? '认证成功前不会检查或公开私有工具。' : catalogAvailable ? '正在使用此连接当前实际注册的工具。' : '上游工具目录不可用，不能据此认为工具已被删除。',
    !catalogAvailable ? 'RETRY_DISCOVERY' : undefined, canInspect && catalogAvailable ? { registeredTools: entries.length } : undefined);
  if (client.protocolVersion) add('protocol', SUPPORTED_PROTOCOL_VERSIONS.includes(client.protocolVersion) ? 'pass' : 'fail',
    SUPPORTED_PROTOCOL_VERSIONS.includes(client.protocolVersion) ? 'protocol_supported' : 'protocol_unsupported',
    'Compared the client-reported protocol version with the installed SDK.', '已对比客户端提供的协议版本与当前 SDK 支持范围。',
    SUPPORTED_PROTOCOL_VERSIONS.includes(client.protocolVersion) ? undefined : 'UPDATE_CLIENT', { supported: SUPPORTED_PROTOCOL_VERSIONS });
  else add('protocol', 'skip', 'client_version_not_supplied', 'Client protocol version was not supplied.', '未提供客户端协议版本。');
  if (client.schemaDialect) add('schema_dialect', client.schemaDialect === 'draft-7' ? 'pass' : 'warn', 'schema_dialect',
    'Tool schemas are published as JSON Schema draft-7; client capability is self-reported.', '工具使用 JSON Schema draft-7；客户端兼容能力来自自报信息。',
    client.schemaDialect === 'draft-7' ? undefined : 'CHECK_CLIENT_SCHEMA_SUPPORT');
  if (client.supportsMcpApps === false) add('ui', 'warn', 'text_fallback', 'This client reports no MCP Apps support. Use the text report or admin console.',
    '客户端报告不支持 MCP Apps，请使用文字报告或管理员控制台。', 'USE_TEXT_FALLBACK');
  if (client.observedFailure) add('client_observation', 'warn', 'client_reported_failure',
    'The client reported a failure. Discovery alone cannot verify registration, refresh or browser consent; inspect the indicated phase.',
    '客户端报告发生过失败。仅检查元数据不能验证注册、刷新或浏览器授权，请检查对应阶段。',
    client.observedFailure.phase === 'registration' ? 'CHECK_CLIENT_REGISTRATION' : client.observedFailure.phase === 'refresh' ? 'RECONNECT_OAUTH' : 'REFRESH_TOOL_DISCOVERY',
    { ...client.observedFailure, source: 'client_reported' });

  const toolChecks = [];
  for (const invocation of invocations) {
    const index = toolChecks.length;
    if (!canInspect || !catalogAvailable) { toolChecks.push({ index, status: 'skip', code: 'catalog_not_inspected' }); continue; }
    const definition = entries.find(e => e.name === invocation.name);
    if (!definition) {
      const normalized = invocation.name.toLowerCase().replace(/[^a-z0-9]+/g, '_');
      const candidates = entries.filter(e => normalized.endsWith(`_${e.name.toLowerCase().replace(/[^a-z0-9]+/g, '_')}`)).map(e => e.name).slice(0, 3);
      toolChecks.push({ index, status: 'fail', code: candidates.length ? 'tool_name_mismatch' : 'tool_not_available',
        protocolCandidates: candidates, nextAction: 'REFRESH_TOOL_DISCOVERY' }); continue;
    }
    const hash = schemaHash(publishedSchema(definition));
    const report = { index, name: definition.name, status: 'pass', code: 'tool_available', schemaHash: hash, executed: false };
    if (invocation.schemaHash && invocation.schemaHash.toLowerCase() !== hash) Object.assign(report, { status: 'fail', code: 'schema_stale', nextAction: 'REFRESH_TOOL_DISCOVERY' });
    if (invocation.arguments !== undefined) {
      const parsed = definition.schema.safeParse(invocation.arguments);
      if (!parsed.success) Object.assign(report, { status: 'fail', code: 'arguments_invalid', nextAction: 'FIX_ARGUMENTS',
        issues: parsed.error.issues.slice(0, 8).map(i => ({ path: i.path.map(safeText).join('.') || '$', code: i.code })) });
      else if (Object.keys(invocation.arguments).some(k => !(k in parsed.data)) && report.status === 'pass') {
        Object.assign(report, { status: 'warn', code: 'arguments_ignored', nextAction: 'REMOVE_UNKNOWN_ARGUMENTS' });
      }
    } else report.argumentsChecked = false;
    toolChecks.push(report);
  }
  const statuses = [...checks, ...toolChecks].map(c => c.status);
  return { reportId: randomUUID(), checkedAt: new Date(now()).toISOString(), surface,
    status: statuses.includes('fail') ? 'fail' : statuses.includes('warn') ? 'warn' : 'pass', checks, toolChecks,
    limitations: pair(locale, 'Read-only inspection. No tool invocation, token refresh, client registration or consent was performed. Protocol candidates are not necessarily your client\'s callable names.',
      '仅执行只读检查，未调用被检查的工具、刷新令牌、注册客户端或执行授权。协议名不一定等于客户端中的可调用名称。') };
}

export function connectionReport(result) {
  return ['## MCP connection check', `**${result.status.toUpperCase()}** · ${result.surface} · ${result.checkedAt}`,
    ...result.checks.map(c => `- **${c.status.toUpperCase()} · ${c.code}**: ${c.message}${c.nextAction ? ` (${c.nextAction})` : ''}`),
    ...result.toolChecks.map(c => `- **${c.status.toUpperCase()} · Tool ${c.index + 1}**: ${c.code}${c.protocolCandidates?.length ? `; protocol candidates: ${c.protocolCandidates.join(', ')}` : ''}${c.issues ? `; ${c.issues.map(i => `${i.path}: ${i.code}`).join('; ')}` : ''}${c.nextAction ? ` (${c.nextAction})` : ''}`),
    '', result.limitations, `Report: ${result.reportId}`].join('\n');
}

export function registerConnectionCheck(registry, context) {
  registry.registerTool('connection.check', { title: 'Check MCP connection',
    description: 'Read-only MCP connection diagnostics: OAuth discovery, verified session, protocol, tool-name and argument-schema checks. Use locale zh for Chinese. Up to 10 sample invocations; never executes them. Do not include credentials or sensitive real payloads in samples. If authentication blocks this tool, use the service /mcp/diagnostics HTTP endpoint.',
    inputSchema: INPUT, annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } }, async args => {
    const start = Date.now();
    const result = await diagnoseConnection(args, { ...context, registry });
    const auditContext = context.requestContext || context.principal?.operationContext;
    if (auditContext) {
      result.traceId = auditContext.traceId;
      await recordToolCall({ context: auditContext, toolName: 'connection.check', status: 'completed', durationMs: Date.now() - start });
    }
    return { structuredContent: result, content: [{ type: 'text', text: connectionReport(result) }] };
  });
}

export async function handleConnectionDiagnostics(req, res, { createPublic, createAdmin, verifyAuth, probe }) {
  const url = new URL(req.url, 'http://localhost');
  res.setHeader('Cache-Control', 'private, no-store, max-age=0');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  if (!['GET', 'POST'].includes(req.method)) { res.writeHead(405, { Allow: 'GET, POST' }).end(); return; }
  let server;
  try {
    const surface = url.searchParams.get('surface') || 'admin';
    if (!['public', 'admin'].includes(surface)) throw new Error('Invalid surface');
    let input = { locale: url.searchParams.get('locale') || 'en' };
    if (req.method === 'POST') {
      if (!/^application\/json\b/.test(req.headers['content-type'] || '')) { res.writeHead(415).end(); return; }
      let body = '';
      const timer = setTimeout(() => req.destroy(), 5000);
      try {
        for await (const chunk of req) { body += chunk; if (Buffer.byteLength(body) > 32768) { res.writeHead(413).end(); return; } }
      } finally { clearTimeout(timer); }
      input = INPUT.parse(JSON.parse(body || '{}'));
    }
    let principal, authError, catalogAvailable = true;
    if (surface === 'admin') {
      try { principal = await verifyAuth(req.headers.authorization); }
      catch (error) { authError = error; }
    }
    if (principal) {
      try { server = await createAdmin(principal); } catch { catalogAvailable = false; }
    }
    server ||= createPublic();
    const report = await diagnoseConnection(input, { surface, principal, authError, catalogAvailable, registry: registryFor(server), probe });
    const status = authError?.statusCode || 200;
    res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'private, no-store, max-age=0',
      'X-Content-Type-Options': 'nosniff', ...(status === 401 ? { 'WWW-Authenticate': bearerChallenge() } : {}) });
    res.end(JSON.stringify({ ...report, markdown: connectionReport(report) }));
  } catch {
    if (!res.headersSent) res.writeHead(400, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify({ error: 'invalid_diagnostic_request', message: 'Use bounded diagnostic options; never include credentials in the request body.' }));
  } finally { await server?.close(); }
}

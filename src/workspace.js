import { readFile } from 'node:fs/promises';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { inputSchemaForTool } from './catalog-client.js';
import { recordToolCall } from './operation-events.js';

export const WORKSPACE_URI = 'ui://yuqi-admin/workspace-v1.html';
export const WORKSPACE_MIME = 'text/html;profile=mcp-app';
const VIEW = z.enum(['visitors', 'operations', 'knowledge']);
const ID = z.string().min(1).max(200);
const WINDOW = z.union([
  z.object({ hours: z.number().int().min(1).max(744) }).strict(),
  z.object({ from: z.string().datetime({ offset: true }), to: z.string().datetime({ offset: true }) }).strict()
    .refine(v => Date.parse(v.to) > Date.parse(v.from) && Date.parse(v.to) - Date.parse(v.from) <= 31 * 86400000,
      'Window must be positive and no longer than 31 days'),
]);
const QUERY = {
  view: VIEW.default('visitors'),
  window: WINDOW.optional(),
  filter: z.object({ query: z.string().max(200).optional(), country: z.string().max(3).optional(),
    city: z.string().max(100).optional(), scope: z.enum(['OWNED', 'INDEXED', 'ALL']).optional() }).strict().optional(),
  page: z.object({ number: z.number().int().min(0).max(1000).default(0),
    size: z.number().int().min(1).max(25).default(15) }).strict().optional(),
};
const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const PATHS = { visitors: '/admin/visitors', operations: '/admin/operations', knowledge: '/admin/knowledge' };
const pick = (value, keys) => Object.fromEntries(keys.filter(k => value?.[k] !== undefined).map(k => [k, value[k]]));
const list = value => Array.isArray(value?.items) ? value.items : [];
let htmlPromise;

export function workspaceHtml() {
  htmlPromise ??= readFile(new URL('../dist/workspace.html', import.meta.url), 'utf8').catch(error => {
    htmlPromise = undefined;
    throw error;
  });
  return htmlPromise;
}

function consoleUrl(view) {
  const base = new URL(process.env.SITE_URL || 'https://www.yuqi.site');
  if (base.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(base.hostname)) throw new Error('Invalid site URL');
  return new URL(PATHS[view], base.origin).href;
}

function unwrap(result) {
  if (result?.isError) {
    const error = new Error('The upstream operation could not be completed.');
    error.details = result.structuredContent || {};
    throw error;
  }
  if (result?.structuredContent) return result.structuredContent;
  try { return JSON.parse(result.content.find(c => c.type === 'text').text); }
  catch { throw new Error('Invalid upstream response'); }
}

function response(view, data) {
  const summary = { view, count: data.items?.length ?? 0, hasMore: data.hasMore === true,
    status: data.status || 'ready', consoleUrl: consoleUrl(view) };
  return { structuredContent: summary,
    content: [{ type: 'text', text: `${view} workspace: ${summary.count} records shown. Status: ${summary.status}. Admin console: ${summary.consoleUrl}` }],
    _meta: { workspace: { ...data, view, consoleUrl: summary.consoleUrl, updatedAt: new Date().toISOString() } } };
}

function failure(error, view) {
  const details = error?.details || {};
  return { isError: true, structuredContent: { error: 'workspace_unavailable', view,
    message: 'Unable to load this view. Check your admin connection and try again.',
    ...pick(details, ['operationId', 'idempotencyKey', 'safeToRetry', 'ambiguousOutcome', 'code']) },
    content: [{ type: 'text', text: 'Workspace request failed. No success is assumed; verify operation status before retrying any write.' }] };
}

// Tickets bind the reviewed target and stable idempotency key to the authenticated
// subject. No credentials or mutable client-provided action payload reach the UI.
export function retryTickets(principal, { now = Date.now, secret = process.env.MCP_GATEWAY_INTERNAL_TOKEN } = {}) {
  const subject = `${principal.sub || ''}:${principal.email}`;
  function mac(payload) {
    if (!secret || secret.length < 16) throw new Error('Retry signing is not configured');
    return createHmac('sha256', secret).update('yuqi-workspace-retry-v1\0').update(payload).digest();
  }
  return {
    issue(action) {
      const claims = { subject, action, expiresAt: now() + 5 * 60000, idempotencyKey: `workspace-${randomUUID()}` };
      const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
      return { ticket: `${payload}.${mac(payload).toString('base64url')}`, ...claims };
    },
    verify(ticket) {
      const [payload, signature, extra] = ticket.split('.');
      if (!payload || !signature || extra) throw new Error('Invalid review ticket');
      const expected = mac(payload), actual = Buffer.from(signature, 'base64url');
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) throw new Error('Invalid review ticket');
      const claims = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
      if (claims.subject !== subject || claims.expiresAt <= now()) throw new Error('Review expired or belongs to another administrator');
      z.object({ kind: z.enum(['INDEXING_JOB', 'OUTBOX_EVENT']), id: ID }).strict().parse(claims.action);
      return claims;
    },
  };
}

export function registerWorkspace(server, principal, catalog, execute, options = {}) {
  if (principal?.role !== 'ADMIN') return;
  const byName = new Map(catalog.map(tool => [tool.name, tool]));
  const tickets = retryTickets(principal, options);
  async function call(name, args) {
    const tool = byName.get(name);
    if (!tool) throw new Error('Tool unavailable for this administrator');
    const parsed = z.object(inputSchemaForTool(tool)).strict().parse(args);
    return unwrap(await execute(tool, parsed));
  }
  function register(name, title, description, schema, handler, { render = false, write = false, appOnly = false } = {}) {
    server.registerTool(name, { title, description, inputSchema: schema,
      annotations: write ? { ...READ, readOnlyHint: false, destructiveHint: true } : READ,
      _meta: { ui: { ...(render ? { resourceUri: WORKSPACE_URI } : {}), visibility: appOnly ? ['app'] : ['model', 'app'] },
        ...(render ? { 'openai/outputTemplate': WORKSPACE_URI } : {}) } }, async args => {
      const start = Date.now();
      try {
        const result = await handler(args);
        await recordToolCall({ context: principal.operationContext, toolName: name,
          status: result.isError ? 'failed' : 'completed', durationMs: Date.now() - start });
        return result;
      } catch (error) {
        await recordToolCall({ context: principal.operationContext, toolName: name,
          status: 'failed', durationMs: Date.now() - start, errorCode: 'WorkspaceError' });
        return failure(error, args.view);
      }
    });
  }
  server.registerResource('admin-workspace', WORKSPACE_URI, {
    title: 'Portfolio Admin Workspace', description: 'Authenticated administrator workspace. No data is embedded in the resource.',
    mimeType: WORKSPACE_MIME,
  }, async () => ({ contents: [{ uri: WORKSPACE_URI, mimeType: WORKSPACE_MIME, text: await workspaceHtml(),
    _meta: { ui: { prefersBorder: true, csp: { connectDomains: [], resourceDomains: [] } } } }] }));

  async function load({ view, filter = {}, window, page = { number: 0, size: 15 } }) {
    const fixedWindow = window?.from ? window : { from: new Date(Date.now() - (window?.hours || 24) * 3600000).toISOString(), to: new Date().toISOString() };
    if (view === 'visitors') {
      const raw = await call('visitor.search_events', { window: fixedWindow, page,
        filter: { ...(filter.query ? { q: filter.query } : {}), ...(filter.country ? { country: filter.country } : {}),
          ...(filter.city ? { city: filter.city } : {}), includeAdmin: false } });
      const items = list(raw).map(item => ({ ...pick(item, ['eventId', 'eventName', 'eventTime', 'sessionId', 'pageUrl',
        'country', 'region', 'city', 'deviceType', 'browser']), automation: item.automationEvidence?.verdict || 'undetermined' }));
      return response(view, { items, summary: raw.summary, page: raw.page, window: { from: raw.from, to: raw.to },
        hasMore: (raw.page?.number + 1) < raw.page?.totalPages, filter,
        notice: 'Network location is approximate. Automation signals do not verify a human or identify the operator.' });
    }
    if (view === 'knowledge') {
      const raw = await call('knowledge.list', { filter: { query: filter.query || '', scope: filter.scope || 'OWNED', status: 'ALL' },
        page: { offset: page.number * page.size, size: page.size } });
      return response(view, { items: list(raw).map(item => pick(item, ['id', 'title', 'preview', 'status', 'sourceType',
        'answerVisibility', 'editable', 'createdAt'])), filter, page: { ...page, totalElements: raw.total },
        hasMore: raw.offset + list(raw).length < raw.total, notice: 'Private knowledge. Visibility controls public answers, not access to these source records.' });
    }
    const sections = await Promise.allSettled([
      call('operation.list', { limit: 25 }), call('admin.list_failed_operations', { limit: 25 }),
    ]);
    if (sections.every(s => s.status === 'rejected')) throw new Error('Operations unavailable');
    const items = sections[0].status === 'fulfilled' ? list(sections[0].value).map(item => pick(item,
      ['operationId', 'idempotencyKey', 'tool', 'state', 'attempt', 'retryable', 'safeToRetry', 'ambiguousOutcome', 'createdAt', 'updatedAt', 'nextAction'])) : [];
    const failures = sections[1].status === 'fulfilled' ? list(sections[1].value).map(item => pick(item,
      ['kind', 'id', 'status', 'operation', 'topic', 'sourceType', 'sourceId', 'retryCount', 'updatedAt'])) : [];
    return response(view, { items, failures, status: sections.some(s => s.status === 'rejected') ? 'partial' : 'ready',
      unavailable: sections.map((s, i) => s.status === 'rejected' ? ['operations', 'failures'][i] : null).filter(Boolean),
      notice: 'Latest 25 records per section. A completed tool call does not imply downstream delivery. Unknown outcomes require verification.' });
  }
  register('workspace.open_view', 'Open admin workspace',
    'Use this when an authenticated administrator wants an interactive visitor timeline, operation status/retry review, or knowledge browser. Opens a private MCP App; reads one bounded page. Not available on public MCP.',
    QUERY, load, { render: true });
  register('workspace.get_view_data', 'Refresh workspace data',
    'Read one bounded page for an existing admin workspace without opening a new UI. Reuse the returned fixed time window when paging visitors.', QUERY, load);
  register('workspace.get_item', 'Read workspace detail',
    'Inspect a selected visitor session, operation timeline or knowledge record. Admin only; use an exact ID from the workspace.',
    { view: VIEW, id: ID, window: WINDOW.optional(), page: z.object({ number: z.number().int().min(0).max(1000).default(0), size: z.number().int().min(1).max(25).default(25) }).strict().optional() },
    async ({ view, id, window, page }) => {
      let detail;
      if (view === 'visitors') {
        if (!window?.from) throw new Error('A fixed window is required for session details');
        detail = await call('visitor.get_session_events', { sessionId: id, window, page: page || { number: 0, size: 25 } });
      } else if (view === 'knowledge') detail = await call('knowledge.get', { id });
      else detail = await call('operation.get_timeline', { id });
      return response(view, { detail, selectedId: id });
    });
  register('workspace.prepare_retry', 'Review a failed task retry',
    'Prepare a five-minute owner-bound review of one failed indexing job or outbox event. Does not execute the retry. Do not prepare a new retry to resolve an uncertain previous attempt.',
    { kind: z.enum(['INDEXING_JOB', 'OUTBOX_EVENT']), id: ID }, async action => {
      const raw = await call('admin.list_failed_operations', { kind: action.kind, limit: 100 });
      const target = list(raw).find(item => item.kind === action.kind && String(item.id) === action.id);
      if (!target || !['FAILED', 'DEAD', 'DEAD_LETTER', 'DEAD_LETTERED'].includes(target.status)) throw new Error('Task is not currently retryable in the bounded result set');
      const review = tickets.issue(action);
      return { structuredContent: { status: 'confirmation_required', action, expiresAt: new Date(review.expiresAt).toISOString() },
        content: [{ type: 'text', text: 'Review prepared. Explicit confirmation is required; no retry has been executed.' }],
        _meta: { workspace: { review: { ticket: review.ticket, action, idempotencyKey: review.idempotencyKey,
          expiresAt: review.expiresAt, target: pick(target, ['operation', 'sourceType', 'sourceId', 'status', 'retryCount']),
          effect: action.kind === 'OUTBOX_EVENT' ? 'Re-publish this event. Downstream indexing or email workflows may run; consumers must deduplicate.' : 'Requeue this indexing job. Its search or RAG projection may be rebuilt.' } } } };
    });
  register('workspace.confirm_retry', 'Confirm the reviewed retry',
    'Execute only the exact signed retry review after the administrator clicks Confirm. Repeated calls reuse its original idempotency key. On timeout or unknown result, inspect operation status; never create a replacement retry.',
    { ticket: z.string().min(20).max(4096), confirmed: z.literal(true) }, async ({ ticket }) => {
      const review = tickets.verify(ticket);
      try {
        const result = await call('admin.retry_failed_operation', { ...review.action, _confirmed: true, _idempotencyKey: review.idempotencyKey });
        const operation = result.operation || result;
        if (result.accepted === false || result.error || operation.ambiguousOutcome ||
            ['UNKNOWN', 'FAILED', 'CANCELLED', 'REJECTED'].includes(operation.state)) {
          throw new Error('Retry has no verified acceptance');
        }
        return { structuredContent: { status: 'accepted', idempotencyKey: review.idempotencyKey,
          message: 'Retry request accepted. Downstream completion is not yet verified.' },
          content: [{ type: 'text', text: 'Retry accepted; verify the operation timeline for its final outcome.' }],
          _meta: { workspace: { receipt: { result, idempotencyKey: review.idempotencyKey } } } };
      } catch (error) {
        return { isError: true, structuredContent: { status: 'verify_required', idempotencyKey: review.idempotencyKey,
          message: 'Retry outcome is not confirmed. Check Operations before taking further action.', safeToRetry: false },
          content: [{ type: 'text', text: 'Retry outcome needs verification. Do not submit a new retry.' }] };
      }
    }, { write: true, appOnly: true });
}

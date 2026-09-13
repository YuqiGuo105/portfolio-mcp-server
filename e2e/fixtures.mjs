const read = (name, parameters = []) => ({ name, mode: 'READ', description: name, requiredRole: 'ADMIN', riskLevel: 'LOW', confirmRequired: false, parameters });
const param = (name, type = 'string', required = false) => ({ name, type, required });
export const catalog = [
  read('visitor.search_events', [param('window', 'object'), param('filter', 'object'), param('page', 'object')]),
  read('visitor.get_session_events', [param('sessionId', 'string', true), param('window', 'object'), param('page', 'object')]),
  read('knowledge.list', [param('filter', 'object'), param('page', 'object')]),
  read('knowledge.get', [param('id', 'string', true)]),
  read('operation.list', [param('limit', 'integer')]),
  read('operation.get_timeline', [param('id', 'string', true)]),
  read('admin.list_failed_operations', [param('kind'), param('limit', 'integer')]),
  { ...read('admin.retry_failed_operation', [param('kind', 'string', true), param('id', 'string', true)]), mode: 'WRITE', confirmRequired: true },
];
export const failed = { id: 'index-42', kind: 'INDEXING_JOB', status: 'FAILED', operation: 'RAG_INDEX', sourceType: 'BLOG', sourceId: 'article-9', retryCount: 2, updatedAt: '2026-09-13T17:15:00Z' };
export function fixture(name, args = {}) {
  if (name.startsWith('visitor.')) {
    const total = args.filter?.q === 'empty' ? 0 : 18;
    const number = args.page?.number || 0, size = args.page?.size || 15;
    const items = Array.from({ length: Math.max(0, Math.min(size, total - number * size)) }, (_, index) => ({
      eventId: `event-${number * size + index}`, eventName: index % 2 ? 'read_progress' : 'page_view', eventTime: '2026-09-13T17:15:00Z',
      serverTime: '2026-09-13T17:15:01Z', sessionId: 'fixture-session-1', pageUrl: 'https://www.yuqi.site/work-single/platform',
      country: 'US', region: 'TX', city: 'Dallas', deviceType: 'desktop', browser: 'Chrome', ipAddress: '192.0.2.10',
      userAgent: 'Fixture Chrome', bot: false,
    }));
    return { items, summary: { totalEvents: total, uniqueVisitors: 4, cities: 2 }, page: { number, size, totalElements: total, totalPages: Math.ceil(total / size) }, from: args.window?.from, to: args.window?.to };
  }
  if (name === 'knowledge.list') return { items: [{ id: 'kb-1', title: 'Platform architecture', preview: '<img src=x onerror=alert(1)> Evidence is rendered as text.', status: 'ACTIVE', sourceType: 'OWNER', answerVisibility: 'private', editable: true, createdAt: '2026-09-13T17:15:00Z' }], offset: 0, total: 1, limit: 15 };
  if (name === 'knowledge.get') return { id: args.id, revision: 'v7', content: 'Owner-approved source content.\nEvidence remains private.', indexing: { status: 'SUCCEEDED' } };
  if (name === 'operation.list') return { items: [{ operationId: 'op-1', tool: 'admin.reindex_rag', state: 'UNKNOWN', attempt: 1, safeToRetry: false, ambiguousOutcome: true, updatedAt: '2026-09-13T17:15:00Z' }] };
  if (name === 'operation.get_timeline') return { operationId: args.id, state: 'UNKNOWN', safeToRetry: false, nextAction: 'VERIFY_OUTCOME', transitions: [{ state: 'RUNNING', attempt: 1, occurred_at: '2026-09-13T17:15:00Z' }, { state: 'UNKNOWN', attempt: 1, occurred_at: '2026-09-13T17:16:00Z' }] };
  if (name === 'admin.list_failed_operations') return { items: [failed], limit: args.limit };
  if (name === 'admin.retry_failed_operation') return { accepted: true, operation: { state: 'SUCCEEDED', operationId: 'retry-1' } };
  throw new Error('Unexpected fixture tool: ' + name);
}

import { createSearchEngine } from './engine.js';
import { plainText } from '../content-format.js';
import { recordPhase } from '../tool-timings.js';

export const SEARCH_TYPES = ['BLOG', 'PROJECT', 'LIFE_BLOG', 'EXPERIENCE'];
const paths = { BLOG: 'blog-single', PROJECT: 'work-single', LIFE_BLOG: 'life-blog' };

export function searchDocument(raw) {
  const type = String(raw.sourceType ?? raw.type ?? '').toUpperCase().replace(/^LIFE$/, 'LIFE_BLOG');
  const id = String(raw.sourceId ?? raw.id ?? '');
  const status = String(raw.status ?? raw.raw?.status ?? '').toUpperCase();
  const visibility = String(raw.visibility ?? raw.raw?.visibility ?? '').toUpperCase();
  if (!SEARCH_TYPES.includes(type) || !/^[a-zA-Z0-9-]{1,80}$/.test(id)
      || (status && !['PUBLISHED', 'ACTIVE'].includes(status))
      || ['PRIVATE', 'ADMIN', 'OWNER'].includes(visibility)
      || /^\[superseded\b/i.test(raw.title ?? '')) return null;
  const text = (v, max) => String(v ?? '').slice(0, max);
  const doc = {
    id, key: `${type}:${id}`, type, title: text(raw.title, 500), summary: plainText(raw.summary ?? raw.description) ?? '',
    tags: (Array.isArray(raw.tags) ? raw.tags : []).filter(t => typeof t === 'string').slice(0, 80).map(t => t.slice(0, 120)),
    category: text(raw.category, 120),
    url: type === 'EXPERIENCE' ? 'https://www.yuqi.site/cv' : `https://www.yuqi.site/${paths[type]}/${id}`,
    // Lists do not always carry access flags. Fail closed for life-post previews.
    sourceRequiresLogin: Boolean(raw.search?.requiresLogin ?? raw.requireLogin ?? raw.require_login ?? raw.raw?.require_login ?? (type === 'LIFE_BLOG')),
    searchText: typeof raw.search?.text === 'string' ? raw.search.text.slice(0, 40000) : '',
    textCoverage: raw.search?.schemaVersion === 1 ? (raw.search.truncated ? 'truncated' : 'full') : 'metadata_only',
  };
  return doc.title ? doc : null;
}

export function createCatalog({ invoke, model, now = Date.now, ttlMs = 60_000 }) {
  let snapshot;
  let expiresAt = 0;
  let pending;
  let retryAt = 0;
  let generation = 0;
  const ttl = Math.min(300_000, Math.max(1000, ttlMs));
  async function refresh() {
    const refreshGeneration = generation;
    const startedAt = performance.now();
    const deadline = Date.now() + 12000;
    // Exactly four bounded reads, shared by all concurrent callers. Await every
    // outcome so failed refreshes cannot leave background work after a response.
    const responses = await Promise.allSettled(SEARCH_TYPES.map(async sourceType => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Search catalog refresh timed out');
      const response = await invoke('admin.search_content', { sourceType, limit: 50 }, undefined, { timeoutMs: Math.min(8000, remaining) });
      const items = response?.items;
      if (!Array.isArray(items)) throw new Error('Search catalog response unavailable');
      // Never silently claim a complete index when an upstream page is truncated.
      if (items.length >= 50) throw new Error('Search catalog requires paginated indexing');
      return items.map(searchDocument).filter(Boolean);
    }));
    const failed = responses.find(response => response.status === 'rejected');
    if (failed) throw failed.reason;
    if (generation !== refreshGeneration) throw new Error('Search catalog invalidated during refresh');
    const docs = responses.flatMap(response => response.value);
    const buildStartedAt = performance.now();
    const next = createSearchEngine(docs, model);
    recordPhase('index_build', buildStartedAt, { documents: docs.length });
    recordPhase('catalog_refresh', startedAt, { documents: docs.length });
    snapshot = next;
    expiresAt = now() + ttl;
    return next;
  }
  return {
    invalidate() { generation++; snapshot = undefined; expiresAt = 0; retryAt = 0; },
    async get() {
      const startedAt = performance.now();
      if (snapshot && now() < expiresAt) {
        recordPhase('catalog', startedAt, { cache: 'hit' });
        return snapshot;
      }
      const cache = pending ? 'coalesced' : 'miss';
      if (!pending) {
        if (now() < retryAt) throw new Error('Search temporarily unavailable');
        const refreshGeneration = generation;
        pending = refresh().catch(error => {
          if (generation === refreshGeneration) retryAt = now() + 10_000;
          throw error;
        }).finally(() => { pending = undefined; });
      }
      // Do not serve stale access metadata after the TTL on a failed refresh.
      try { return await pending; }
      finally { recordPhase('catalog', startedAt, { cache }); }
    },
  };
}

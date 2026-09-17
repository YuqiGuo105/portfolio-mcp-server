import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { readSearchSource } from './source.js';
import { createCatalog, SEARCH_TYPES } from './catalog.js';

let model;
try { model = JSON.parse(readFileSync(new URL('./ranker.json', import.meta.url), 'utf8')); } catch { /* Baseline remains available. */ }
export const searchCatalog = createCatalog({ invoke: readSearchSource, model });

export async function searchContent(args, catalog = searchCatalog) {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query || query.length > 300) throw new RangeError('Query must contain 1 to 300 characters');
  if (args.types && (!Array.isArray(args.types) || !args.types.length || args.types.some(t => !SEARCH_TYPES.includes(t)))) throw new RangeError('Invalid content types');
  const started = performance.now();
  const engine = await catalog.get();
  const result = engine.search(query, { ...args, ranker: process.env.SEARCH_RANKER === 'baseline' ? 'baseline' : undefined });
  const groups = { projects: [], articles: [], life: [], experience: [] };
  const group = { PROJECT: 'projects', BLOG: 'articles', LIFE_BLOG: 'life', EXPERIENCE: 'experience' };
  for (const item of result.results) groups[group[item.type]].push(item);
  return { ...result, query, groups, requestId: randomUUID(), tookMs: Math.round(performance.now() - started),
    indexedDocuments: engine.size, status: result.total ? 'EVIDENCE_FOUND' : 'NO_EVIDENCE',
    guidance: 'Search results contain discoverable metadata only. sourceRequiresLogin means sign in to read the original; no result does not prove a fact is absent.' };
}

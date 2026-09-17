import { readFileSync } from 'node:fs';
import { createSearchEngine, FEATURE_NAMES } from '../src/search/engine.js';
import { searchDocument } from '../src/search/catalog.js';

const corpus = JSON.parse(readFileSync(new URL('../evaluation/search/corpus.json', import.meta.url)));
const queries = JSON.parse(readFileSync(new URL('../evaluation/search/judgments.json', import.meta.url)));
const engine = createSearchEngine(corpus.map(searchDocument).filter(Boolean));
console.log(JSON.stringify({ features: FEATURE_NAMES, indexVersion: engine.version,
  queries: queries.map(q => ({ ...q, candidates: engine.candidates(q.query, { types: q.types }).map(hit => ({
    id: hit.doc.key, features: hit.features, baseline: hit.baseline, grade: q.relevance[hit.doc.key] ?? 0,
  })) })),
}));

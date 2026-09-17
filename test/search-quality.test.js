import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSearchEngine } from '../src/search/engine.js';
import { searchDocument } from '../src/search/catalog.js';

const read = path => JSON.parse(readFileSync(new URL(path, import.meta.url)));
const corpus = read('../evaluation/search/corpus.json');
const judgments = read('../evaluation/search/judgments.json');
const model = read('../src/search/ranker.json');
const engine = createSearchEngine(corpus.map(searchDocument).filter(Boolean), model);

test('versioned learned ranker does not regress against RRF on the curated development set', () => {
  assert.match(model.version, /^pairwise-lr-/);
  assert.ok(model.trainingPairs > 0);
  const train = new Set(judgments.filter(q => q.split === 'train').map(q => q.group));
  const dcg = grades => grades.reduce((sum, grade, i) => sum + (2 ** grade - 1) / Math.log2(i + 2), 0);
  let candidate = 0, baseline = 0;
  for (const q of judgments.filter(q => q.split === 'test')) {
    assert.ok(!train.has(q.group));
    const ideal = dcg(Object.values(q.relevance).sort((a, b) => b - a).slice(0, 5));
    const score = ranker => {
      const result = engine.search(q.query, { types: q.types, limit: 5, ranker });
      return ideal ? dcg(result.results.map(d => q.relevance[d.key] ?? 0)) / ideal : Number(!result.total);
    };
    candidate += score(undefined);
    baseline += score('baseline');
  }
  assert.ok(candidate >= baseline - 1e-9, `${candidate} < ${baseline}`);
});

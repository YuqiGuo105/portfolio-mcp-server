import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createSearchEngine, validModel } from '../src/search/engine.js';
import { createCatalog, searchDocument } from '../src/search/catalog.js';
import { searchContent } from '../src/search/service.js';

const corpus = JSON.parse(readFileSync(new URL('../evaluation/search/corpus.json', import.meta.url)));
const model = JSON.parse(readFileSync(new URL('../src/search/ranker.json', import.meta.url)));
const engine = createSearchEngine(corpus.map(searchDocument).filter(Boolean), model);

test('numeralonyms resolve from catalog vocabulary without hardcoded result mappings', () => {
  for (const query of ['k8s', 'K8S', 'k8s orchestration']) {
    assert.match(engine.search(query).results[0]?.title ?? '', /Kubernetes vs Docker/, query);
  }
  assert.ok(engine.search('k8s', { types: ['PROJECT'] }).results.every(doc => doc.type === 'PROJECT'));
  const docs = ['internationalization', 'Other topic'].map((title, i) => searchDocument({
    sourceType: 'BLOG', sourceId: String(i), title,
  }));
  assert.equal(createSearchEngine(docs, model).search('i18n').results[0]?.title, 'internationalization');
  assert.equal(engine.search('z87q').total, 0);
  const ambiguous = ['kubernetes', 'kabcdefghs'].map((title, i) => searchDocument({ sourceType: 'BLOG', sourceId: String(i), title }));
  assert.equal(createSearchEngine(ambiguous, model).search('k8s').total, 0);
});

test('bilingual city queries and spelling correction recall the same restricted source', () => {
  for (const query of ['盐湖城', 'Salt Lake City', 'SLC', '芝加哥', '克里夫兰', 'did he go to chiago']) {
    const result = engine.search(query);
    assert.equal(result.results[0]?.key, 'LIFE_BLOG:2', query);
    assert.equal(result.results[0].sourceRequiresLogin, true);
    assert.equal(result.results[0].url, 'https://www.yuqi.site/life-blog/2');
  }
});

test('all active content types, tags and category filters are indexed', () => {
  assert.equal(engine.size, 16);
  for (const q of ['版本控制', '视频通话', '访客分析', 'CuraStone']) assert.ok(engine.search(q).total, q);
  assert.equal(engine.search('盐湖城', { types: ['PROJECT'] }).total, 0);
  assert.equal(engine.search('盐湖城', { category: 'Travel' }).results[0].id, '2');
  assert.equal(engine.search('量子纠缠实验室').total, 0);
  assert.equal(engine.search('zzzz-no-such-document-93478').total, 0);
});

test('pagination preserves a stable global ordering and model failures use baseline', () => {
  const all = engine.search('Kafka', { limit: 50 });
  const pages = [0, 2, 4, 6].flatMap(offset => engine.search('Kafka', { offset, limit: 2 }).results);
  assert.deepEqual(pages.map(x => x.key), all.results.map(x => x.key));
  assert.equal(validModel({ ...model, weights: [NaN] }), false);
  assert.equal(validModel({ ...model, features: {} }), false);
  const baseline = createSearchEngine(corpus.map(searchDocument).filter(Boolean), { invalid: true });
  assert.equal(baseline.search('Salt Lake City').modelVersion, 'rrf-baseline-v1');
});

test('restricted body participates in recall but never appears in search previews', () => {
  const doc = searchDocument({ sourceType: 'LIFE_BLOG', sourceId: '2', title: 'Travel journal',
    search: { schemaVersion: 1, requiresLogin: true, text: 'UnlistedPlace secret-body-string', truncated: false },
    raw: { token: 'secret-token' } });
  const result = createSearchEngine([doc], model).search('UnlistedPlace');
  assert.equal(result.total, 1);
  assert.equal(result.coverage.fullText, 1);
  assert.ok(!JSON.stringify(result).includes('secret-body-string'));
  assert.ok(!JSON.stringify(result).includes('secret-token'));
  assert.equal(result.results[0].sourceRequiresLogin, true);
});

test('late body terms are not silently dropped at an arbitrary token boundary', () => {
  const docs = [0, 1, 2].map(i => searchDocument({ sourceType: 'BLOG', sourceId: String(i), title: `Article ${i}`,
    search: { schemaVersion: 1, text: i ? 'Unrelated prose' : 'word '.repeat(3000) + 'lateuniqueterm', requiresLogin: false, truncated: false } }));
  assert.equal(createSearchEngine(docs, model).search('lateuniqueterm').results[0]?.id, '0');
});

test('private, draft and superseded records are excluded, canonical links cannot be injected', () => {
  for (const fields of [{ visibility: 'PRIVATE' }, { status: 'DRAFT' }, { title: '[Superseded Draft] old' }]) {
    assert.equal(searchDocument({ sourceType: 'PROJECT', sourceId: 'id', title: 'Project', ...fields }), null);
  }
  const doc = searchDocument({ sourceType: 'PROJECT', sourceId: 'id', title: 'Project', url: 'javascript:alert(1)' });
  assert.equal(doc.url, 'https://www.yuqi.site/work-single/id');
});

test('catalog refresh is single-flight, bounded and does not serve stale permissions', async () => {
  let now = 0, calls = 0, unavailable = false;
  const catalog = createCatalog({ now: () => now, ttlMs: 1000, invoke: async (_, args) => {
    calls++; if (unavailable) throw new Error('upstream unavailable');
    return { items: corpus.filter(x => x.sourceType === args.sourceType) };
  }, model });
  const first = catalog.get(), concurrent = catalog.get();
  assert.equal(await first, await concurrent);
  await catalog.get(); assert.equal(calls, 4);
  now = 1001; unavailable = true;
  await assert.rejects(catalog.get(), /unavailable/);
  await assert.rejects(catalog.get(), /unavailable/);
  assert.equal(calls, 8, 'a failed parallel refresh is not retried during backoff');
});

test('catalog overlaps only four reads and coalesces concurrent callers', async () => {
  const waiting = [];
  const catalog = createCatalog({ invoke: (_, args) => new Promise(resolve => waiting.push(() =>
    resolve({ items: corpus.filter(item => item.sourceType === args.sourceType) }))) });
  const calls = Array.from({ length: 20 }, () => catalog.get());
  assert.equal(waiting.length, 4, 'all types start before any response, with no fan-out per caller');
  waiting.forEach(resolve => resolve());
  const results = await Promise.all(calls);
  assert.ok(results.every(result => result === results[0]));
});

test('a failed refresh waits for in-flight reads and never publishes a partial index', async () => {
  const waiting = [];
  const catalog = createCatalog({ invoke: (_, args) => args.sourceType === 'BLOG'
    ? Promise.reject(new Error('upstream failed'))
    : new Promise(resolve => waiting.push(() => resolve({ items: [] }))) });
  let settled = false;
  const result = catalog.get().catch(error => { settled = true; return error; });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false);
  waiting.forEach(resolve => resolve());
  assert.match((await result).message, /upstream failed/);
  await assert.rejects(catalog.get(), /unavailable/);
});

test('invalidation during refresh cannot republish the old access flags', async () => {
  const waiting = [];
  const catalog = createCatalog({ invoke: () => new Promise(resolve => waiting.push(resolve)) });
  const old = catalog.get();
  catalog.invalidate();
  waiting.splice(0).forEach(resolve => resolve({ items: corpus }));
  await assert.rejects(old, /invalidated/);
  const fresh = catalog.get();
  assert.equal(waiting.length, 4);
  waiting.forEach(resolve => resolve({ items: [] }));
  assert.equal((await fresh).size, 0);
});

test('truncated upstream pages are reported rather than silently hiding content', async () => {
  const catalog = createCatalog({ invoke: async () => ({ items: Array.from({ length: 50 }, () => corpus[0]) }) });
  await assert.rejects(catalog.get(), /paginated/);
});

test('service rejects invalid query and type before accessing a backend', async () => {
  const catalog = { get() { throw new Error('should not access'); } };
  for (const args of [{ query: '' }, { query: 'a'.repeat(301) }, { query: 'q', types: ['PRIVATE'] }]) {
    await assert.rejects(searchContent(args, catalog), RangeError);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPortfolioSearchResult, tools } from '../src/tools.js';

test('mixed language query falls back to bounded term union with upstream type filters', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  const calls = [];
  globalThis.fetch = async (_, options) => {
    const args = JSON.parse(options.body);
    calls.push(args);
    const match = ['面试', 'offer'].includes(args.keyword) && args.sourceType === 'LIFE_BLOG';
    return new Response(JSON.stringify({ items: match ? [
      { sourceType: 'LIFE_BLOG', sourceId: '1', title: 'New Grad Offer', summary: 'Interview journal' },
    ] : [] }));
  };
  const result = await tools.find(tool => tool.name === 'search_portfolio').handler({
    query: '面试 interview job offer', types: ['LIFE_BLOG', 'BLOG'], limit: 5,
  });
  assert.equal(result.total, 1);
  assert.equal(result.groups.life[0].id, '1');
  assert.equal(result.searchMode, 'keyword_union');
  assert.equal(calls.length, 10);
  assert.ok(calls.every(c => ['LIFE_BLOG', 'BLOG'].includes(c.sourceType) && c.limit === 5));
});

test('upstream failure is not misrepresented as zero search results', async t => {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(() => tools.find(tool => tool.name === 'search_portfolio').handler({query:'interview'}));
});

test('unified portfolio search ranks matches and groups every public content type', () => {
  const result = buildPortfolioSearchResult('Java', [
    { id: 'experience-1', type: 'EXPERIENCE', title: 'Software Engineer', summary: 'Java services' },
    { id: 'article-1', type: 'BLOG', title: 'Reliable APIs', summary: 'Examples in Java' },
    { id: 'life-1', type: 'LIFE', title: 'Conference notes', summary: 'Java community' },
    { id: 'project-1', type: 'PROJECT', title: 'Java Platform', tags: ['Java'] },
  ], 4);

  assert.equal(result.total, 4);
  assert.equal(result.results[0].id, 'project-1');
  assert.deepEqual(result.groups.projects.map(item => item.id), ['project-1']);
  assert.deepEqual(result.groups.articles.map(item => item.id), ['article-1']);
  assert.deepEqual(result.groups.life.map(item => item.id), ['life-1']);
  assert.deepEqual(result.groups.experience.map(item => item.id), ['experience-1']);
});

test('unified portfolio search enforces the public result limit', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    type: 'PROJECT',
    title: `Project ${index}`,
    summary: 'distributed systems',
  }));

  const result = buildPortfolioSearchResult('distributed', items, 50);

  assert.equal(result.total, 20);
  assert.equal(result.groups.projects.length, 20);
});

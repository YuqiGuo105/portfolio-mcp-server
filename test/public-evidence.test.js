import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from '../src/tools.js';
import { sanitizeContentDetail } from '../src/sanitize.js';

function mockGateway(t, handler) {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async (url, options) => new Response(JSON.stringify(handler(url, JSON.parse(options.body))));
}

test('article search covers life/travel posts and keeps category filtering', async t => {
  const calls = [];
  mockGateway(t, (_, args) => {
    calls.push(args);
    return { items: args.sourceType === 'LIFE_BLOG' ? [{ sourceId: '2', sourceType: 'LIFE_BLOG', title: 'Travel journal', raw: { require_login: false } }] : [] };
  });
  const result = await tools.find(t => t.name === 'search_articles').handler({ keyword: 'Chicago', category: 'Travel' });
  assert.equal(result.total, 1);
  assert.equal(result.articles[0].url, 'https://www.yuqi.site/life-blog/2');
  assert.deepEqual(result.searchedTypes, ['BLOG', 'LIFE_BLOG']);
  assert.ok(calls.every(call => call.category === 'Travel'));
});

test('article search supports an explicit technical-only collection', async t => {
  mockGateway(t, (url, args) => {
    if (url.includes('portfolio.search_public_knowledge')) return { evidence: [], total: 0 };
    assert.equal(args.sourceType, 'BLOG');
    return { items: [] };
  });
  const result = await tools.find(t => t.name === 'search_articles').handler({ keyword: 'missing', sourceType: 'BLOG' });
  assert.equal(result.total, 0);
  assert.match(result.guidance, /not proof of absence/);
});

test('life article lookup passes collection to gateway and exposes all pages', async t => {
  const body = 'a'.repeat(8100) + 'Chicago and Salt Lake City';
  mockGateway(t, (_, args) => {
    assert.equal(args.sourceType, 'LIFE_BLOG');
    assert.equal(args.sourceId, '2');
    return { content: { sourceId: '2', sourceType: 'LIFE_BLOG', content: body, raw: { require_login: false } } };
  });
  const tool = tools.find(t => t.name === 'get_article');
  const first = await tool.handler({ articleId: '2', sourceType: 'LIFE_BLOG' });
  assert.equal(first.truncated, true);
  const second = await tool.handler({ articleId: '2', sourceType: 'LIFE_BLOG', offset: first.nextOffset });
  assert.equal(first.body + second.body, body);
  assert.equal(second.truncated, false);
  assert.equal(second.nextOffset, undefined);
});

test('legacy technical article lookup defaults to BLOG', async t => {
  mockGateway(t, (_, args) => {
    assert.equal(args.sourceType, 'BLOG');
    return { sourceId: 'a', sourceType: 'BLOG', content: 'text' };
  });
  assert.equal((await tools.find(t => t.name === 'get_article').handler({ articleId: 'a' })).body, 'text');
});

test('older clients can read a numeric life-post ID without the new sourceType parameter', async t => {
  mockGateway(t, (_, args) => {
    assert.equal(args.sourceType, 'LIFE_BLOG');
    return { sourceId: '2', sourceType: 'LIFE_BLOG', content: 'Travel entry', raw: { require_login: false } };
  });
  assert.equal((await tools.find(t => t.name === 'get_article').handler({ articleId: '2' })).body, 'Travel entry');
});

test('profile reads approved education evidence and maps normalized experience', async t => {
  mockGateway(t, (url, args) => {
    if (url.includes('portfolio.get_public_profile')) return {
      profileEvidence: [{ text: 'Master of Computer Science from Example University', sourceRequiresLogin: true }],
    };
    assert.equal(args.keyword, undefined);
    return { items: [{ title: 'Employer', summary: 'Engineer', content: 'Backend work', raw: { date: '2024 - present', private: 'secret' } }] };
  });
  const result = await tools.find(t => t.name === 'get_profile').handler({});
  assert.equal(result.experience[0].company, 'Employer');
  assert.equal(result.experience[0].title, 'Engineer');
  assert.equal(result.experience[0].description, 'Backend work');
  assert.equal(result.status, 'EVIDENCE_FOUND');
  assert.match(result.profileEvidence[0].text, /Example University/);
  assert.ok(!('education' in result));
  assert.ok(!('skills' in result));
  assert.ok(!JSON.stringify(result).includes('secret'));
});

test('article keyword miss falls back to semantic evidence without a city alias dictionary', async t => {
  mockGateway(t, (url, args) => {
    if (url.includes('portfolio.search_public_knowledge')) {
      assert.equal(args.query, 'SLC');
      return { evidence: [{ text: 'Owner-approved travel answer', sourceRequiresLogin: true }], total: 1 };
    }
    return { items: [] };
  });
  const result = await tools.find(t => t.name === 'search_articles').handler({ keyword: 'SLC' });
  assert.equal(result.total, 0);
  assert.equal(result.evidenceTotal, 1);
  assert.equal(result.status, 'EVIDENCE_FOUND');
});

test('semantic retrieval failure stays an error rather than a false no-evidence claim', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async url => url.includes('portfolio.search_public_knowledge')
    ? new Response('unavailable', { status: 503 })
    : new Response(JSON.stringify({ items: [] }));
  await assert.rejects(tools.find(t => t.name === 'search_articles').handler({ keyword: 'SLC' }));
});

test('profile retrieval failure does not return incomplete records as a complete profile', async t => {
  const original = globalThis.fetch;
  t.after(() => { globalThis.fetch = original; });
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  await assert.rejects(tools.find(t => t.name === 'get_profile').handler({}));
});

test('out of range article offset cannot loop or return the start again', () => {
  const result = sanitizeContentDetail({ content: 'short' }, { offset: 500 });
  assert.equal(result.body, '');
  assert.equal(result.offset, 5);
  assert.equal(result.truncated, false);
});

test('restricted or unknown life-article access does not expose the original body or source URL', () => {
  for (const raw of [{ require_login: true }, {}]) {
    const result = sanitizeContentDetail({ sourceType: 'LIFE_BLOG', sourceId: '2', content: 'restricted original', raw });
    assert.equal(result.status, 'SOURCE_REQUIRES_LOGIN');
    assert.equal(result.sourceRequiresLogin, true);
    assert.equal(result.body, undefined);
    assert.equal(result.url, undefined);
  }
});

test('matching a restricted article still retrieves public-answer evidence', async t => {
  mockGateway(t, (url, args) => {
    if (url.includes('portfolio.search_public_knowledge')) return { evidence: [{ text: 'Approved public travel fact' }], total: 1 };
    return { items: args.sourceType === 'LIFE_BLOG'
      ? [{ sourceType: 'LIFE_BLOG', sourceId: '2', title: 'Travel', raw: { require_login: true } }] : [] };
  });
  const result = await tools.find(t => t.name === 'search_articles').handler({ keyword: 'Chicago' });
  assert.equal(result.total, 1);
  assert.equal(result.evidenceTotal, 1);
  assert.equal(result.articles[0].url, undefined);
});

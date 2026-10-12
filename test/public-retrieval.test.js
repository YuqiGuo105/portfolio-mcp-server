import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from '../src/tools.js';
import { searchCatalog } from '../src/search/service.js';
import { excerpt, safeKnowledge } from '../src/public-evidence.js';
import { sanitizeContentItem } from '../src/sanitize.js';
import { searchDocument } from '../src/search/catalog.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../src/index.js';

const call = (name, args = {}) => tools.find(t => t.name === name).handler(args);
const project = { sourceId: 'public-project', sourceType: 'PROJECT', title: 'Open Source Contributions',
  tags: ['Spring AI Alibaba', 'LangExtract', '开源贡献'], summary: 'Workflow recovery and bounded retries',
  content: '<h1>Open source</h1><p>Implemented bounded retries for Spring AI Alibaba and LangExtract.</p>',
  search: { schemaVersion: 1, text: 'CACHE_PRIVATE_CANARY', requiresLogin: false } };
const locked = { sourceId: '2', sourceType: 'LIFE_BLOG', title: 'Travel', tags: ['Chicago'], requireLogin: true,
  content: 'RESTRICTED_ORIGINAL_CANARY', search: { schemaVersion: 1, text: 'RESTRICTED_ORIGINAL_CANARY', requiresLogin: true } };

function fixture(t, { semantic = [], source = project, outage = false } = {}) {
  searchCatalog.invalidate();
  t.after(() => searchCatalog.invalidate());
  const originalFetch = globalThis.fetch;
  return t.mock.method(globalThis, 'fetch', async (url, init) => {
    if (String(url).includes('127.0.0.1')) return originalFetch(url, init);
    const args = JSON.parse(init.body);
    if (String(url).includes('search_public_knowledge')) {
      if (outage) return new Response('offline', { status: 503 });
      return Response.json({ evidence: semantic, total: semantic.length });
    }
    if (String(url).includes('get_content')) return Response.json(args.sourceType === 'LIFE_BLOG' ? locked : source);
    return Response.json({ items: [project, locked].filter(doc => doc.sourceType === args.sourceType) });
  });
}

test('semantic misses and outages still return live lexical project evidence without cached body', async t => {
  fixture(t, { outage: true });
  const result = await call('search_knowledge', { query: 'Spring AI Alibaba LangExtract Kubernetes pull request' });
  assert.equal(result.evidence[0].sourceId, project.sourceId);
  assert.match(result.evidence[0].text, /Implemented bounded retries/);
  assert.equal(result.coverage.semantic, 'UNAVAILABLE');
  assert.ok(!JSON.stringify(result).includes('CANARY'));
});

test('bilingual contribution question returns project evidence even with weak semantic hit', async t => {
  fixture(t, { semantic: [{ sourceType: 'PROFILE', review: 'approved', text: 'University degree' }] });
  const result = await call('search_knowledge', { query: 'Yuqi 做过哪些开源贡献？' });
  assert.equal(result.evidence[0].sourceType, 'PROJECT');
});

test('current source restrictions revoke excerpts even when metadata cache says public', async t => {
  fixture(t, { source: { ...project, requireLogin: true } });
  const result = await call('search_portfolio', { query: 'LangExtract' });
  assert.equal(result.results[0].sourceRequiresLogin, true);
  assert.equal(result.results[0].snippet, undefined);
  assert.ok(!JSON.stringify(result).includes('Implemented'));
});

test('draft and deleted source cannot become quoted evidence', async t => {
  fixture(t, { source: { ...project, raw: { publication_status: 'DRAFT' } } });
  const result = await call('search_portfolio', { query: 'LangExtract' });
  assert.deepEqual(result.results, []);
});

test('restricted and unverified semantic rows are rejected; reviewed answers stay separate', () => {
  const result = safeKnowledge({ evidence: [
    { sourceType: 'LIFE_BLOG', sourceId: '2', text: 'SECRET', sourceRequiresLogin: true, accessVerified: true },
    { sourceType: 'BLOG', sourceId: 'a', text: 'UNVERIFIED', sourceRequiresLogin: false },
    { sourceType: 'OWNER_QA', review: 'approved', text: 'Approved answer', url: 'private-source' },
  ] });
  assert.equal(result.length, 1);
  assert.ok(!JSON.stringify(result).includes('private-source'));
  assert.equal(result[0].sourceRequiresLogin, true);
});

test('list, detail, and search derive the same access flag with fail-closed legacy life posts', () => {
  for (const flag of [true, false, undefined]) {
    const row = { sourceType: 'LIFE_BLOG', sourceId: '1', title: 'Sample', requireLogin: flag };
    assert.equal(Boolean(sanitizeContentItem(row).sourceRequiresLogin), searchDocument(row).sourceRequiresLogin);
  }
});

test('role evidence has quotes and gaps, never a hiring score or model request', async t => {
  const mock = fixture(t);
  const result = await call('match_role', { requirements: ['LangExtract retries', 'COBOL mainframe'] });
  assert.equal(result.matches.length, 1);
  assert.match(result.matches[0].evidence[0].quote, /LangExtract/);
  assert.equal(result.gaps[0].requirement, 'COBOL mainframe');
  assert.equal(result.score, undefined);
  assert.ok(!mock.mock.calls.some(c => String(c.arguments[0]).includes('search_public_knowledge')));
  assert.ok(mock.mock.callCount() <= 12);
});

test('overview performs no network request and exposes its editorial review date', async t => {
  t.mock.method(globalThis, 'fetch', () => { throw new Error('Unexpected network'); });
  const result = await call('get_overview');
  assert.equal(result.projects.length, 3);
  assert.match(result.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  result.name = 'changed';
  assert.equal((await call('get_overview')).name, 'Yuqi Guo');
});

test('excerpt locates query terms late in long text and stays bounded', () => {
  const result = excerpt('Kafka outbox', 'Introduction '.repeat(1000) + 'Kafka outbox preserves publication events.');
  assert.match(result.text, /Kafka outbox/);
  assert.ok(result.text.length <= 650);
});

test('HTTP MCP E2E discovers and executes overview, hybrid search, role evidence, aliases and denial', async t => {
  fixture(t);
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const client = new Client({ name: 'public-evidence-e2e', version: '1' });
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const names = (await client.listTools()).tools.map(tool => tool.name);
  assert.ok(names.includes('get_overview') && names.includes('match_role'));
  const invoke = async (name, args = {}) => {
    const response = await client.callTool({ name, arguments: args });
    assert.ok(!response.isError, JSON.stringify(response));
    return JSON.parse(response.content[0].text);
  };
  assert.equal((await invoke('get_overview')).projects.length, 3);
  assert.equal((await invoke('search_knowledge', { query: 'LangExtract' })).evidence[0].sourceId, project.sourceId);
  assert.equal((await invoke('match_role', { requirements: ['LangExtract retries', 'COBOL mainframe'] })).gaps.length, 1);
  const unified = await invoke('search_portfolio', { query: 'LangExtract', types: ['PROJECT'] });
  const alias = await invoke('search_projects', { keyword: 'LangExtract' });
  assert.deepEqual(alias.projects, unified.results);
  const restricted = await invoke('search_articles', { keyword: 'Chicago' });
  assert.ok(!JSON.stringify(restricted).includes('RESTRICTED_ORIGINAL_CANARY'));
  assert.equal(restricted.articles[0].sourceRequiresLogin, true);
  const invalid = await client.callTool({ name: 'match_role', arguments: { requirements: [] } });
  assert.ok(invalid.isError);
  assert.equal((await fetch(`${base}/mcp/admin`, { method: 'POST' })).status, 401);
});

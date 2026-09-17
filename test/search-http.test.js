import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createHttpServer } from '../src/index.js';
import { searchCatalog } from '../src/search/service.js';

test('HTTP and MCP use the same ranked catalog without exposing protected bodies', async t => {
  const corpus = JSON.parse(readFileSync(new URL('../evaluation/search/corpus.json', import.meta.url)));
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    if (String(url).includes('/api/tools/admin.search_content/')) {
      calls++;
      const args = JSON.parse(options.body);
      return Response.json({ items: corpus.filter(d => d.sourceType === args.sourceType).map(d => ({ ...d,
        search: { schemaVersion: 1, text: 'INTERNAL_BODY_NOT_FOR_PREVIEW', requiresLogin: d.sourceType === 'LIFE_BLOG', truncated: false } })) });
    }
    if (String(url).includes('/api/tools/portfolio.search_public_knowledge/')) return Response.json({ evidence: [], total: 0 });
    if (String(url).includes('127.0.0.1')) return originalFetch(url, options);
    return Response.json({});
  };
  searchCatalog.invalidate();
  const server = createHttpServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const client = new Client({ name: 'search-e2e', version: '1' });
  t.after(async () => { await client.close(); server.closeAllConnections(); await new Promise(r => server.close(r)); globalThis.fetch = originalFetch; searchCatalog.invalidate(); });
  const response = await fetch(`${base}/api/search?q=${encodeURIComponent('盐湖城')}`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const http = await response.json();
  assert.equal(http.results[0].url, 'https://www.yuqi.site/life-blog/2');
  assert.equal(http.results[0].sourceRequiresLogin, true);
  assert.ok(!JSON.stringify(http).includes('INTERNAL_BODY'));
  await client.connect(new StreamableHTTPClientTransport(new URL(`${base}/mcp`)));
  const result = await client.callTool({ name: 'search_articles', arguments: { keyword: '盐湖城' } });
  assert.ok(!result.isError);
  const mcp = JSON.parse(result.content[0].text);
  assert.equal(mcp.articles[0].key, http.results[0].key);
  assert.equal(mcp.modelVersion, http.modelVersion);
  assert.ok(!JSON.stringify(mcp).includes('INTERNAL_BODY'));
  assert.equal(calls, 4, 'both transports reuse the bounded catalog');
  assert.equal((await fetch(`${base}/api/search?q=x&types=PRIVATE`)).status, 400);
  assert.equal((await fetch(`${base}/api/search?q=x`, { method: 'POST' })).status, 405);
  assert.equal((await fetch(`${base}/mcp/admin`, { method: 'POST' })).status, 401);
});

test('unavailable search returns 503, never a false zero-result success', async t => {
  const server = createHttpServer({ search: async () => { throw new Error('private infrastructure detail'); } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(async () => { server.closeAllConnections(); await new Promise(r => server.close(r)); });
  const response = await fetch(`http://127.0.0.1:${server.address().port}/api/search?q=hello`);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'SEARCH_UNAVAILABLE');
});

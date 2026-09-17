import test from 'node:test';
import assert from 'node:assert/strict';
import { readSearchSource } from '../src/search/source.js';

function setup(t, fetchImpl) {
  const original = { fetch: globalThis.fetch, url: process.env.ADMIN_SERVICE_URL, token: process.env.SEARCH_PROJECTION_ADMIN_SECRET };
  process.env.ADMIN_SERVICE_URL = 'https://admin.example';
  process.env.SEARCH_PROJECTION_ADMIN_SECRET = 'test-only';
  globalThis.fetch = fetchImpl;
  t.after(() => {
    globalThis.fetch = original.fetch;
    for (const [key, value] of [['ADMIN_SERVICE_URL', original.url], ['SEARCH_PROJECTION_ADMIN_SECRET', original.token]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  });
}

test('internal search uses the bounded authenticated projection, not expanded MCP lists', async t => {
  setup(t, async (url, options) => {
    assert.equal(new URL(url).pathname, '/api/admin/content/search-projection');
    assert.equal(new URL(url).searchParams.get('limit'), '50');
    assert.equal(options.headers['X-Admin-Secret'], 'test-only');
    assert.equal(options.redirect, 'error');
    return Response.json({ items: [], schemaVersion: 1 });
  });
  assert.deepEqual(await readSearchSource('admin.search_content', { sourceType: 'BLOG', limit: 50 }), { items: [], schemaVersion: 1 });
});

test('only an old deployment 404 allows metadata compatibility fallback', async t => {
  let calls = 0;
  setup(t, async url => {
    calls++;
    return String(url).includes('search-projection') ? new Response('', { status: 404 }) : Response.json({ items: [] });
  });
  await readSearchSource('admin.search_content', { sourceType: 'BLOG', limit: 50 });
  assert.equal(calls, 2);
});

test('permission errors and infrastructure failures do not fall back around the boundary', async t => {
  let currentStatus, calls;
  setup(t, async () => { calls++; return new Response('', { status: currentStatus }); });
  for (const status of [401, 403, 500, 503]) {
    currentStatus = status; calls = 0;
    await assert.rejects(readSearchSource('admin.search_content', { sourceType: 'BLOG', limit: 50 }));
    assert.equal(calls, 1);
  }
});

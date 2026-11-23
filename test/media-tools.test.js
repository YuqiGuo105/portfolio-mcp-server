import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAdminServer, createServer } from '../src/index.js';
import { buildVisibleToolIndex, searchToolIndex } from '../src/tool-discovery.js';

const catalog = [
  { name: 'media.get', mode: 'READ', parameters: [{ name: 'id', type: 'string', required: true }] },
  { name: 'media.get_presentation', mode: 'READ', parameters: [{ name: 'placementKey', type: 'string', required: true }] },
  { name: 'media.set_presentation', mode: 'WRITE', parameters: [
    { name: 'placementKey', type: 'string', required: true }, { name: 'id', type: 'string', required: true },
    { name: 'expectedRevision', type: 'string', required: true }, { name: 'chapters', type: 'array', required: false },
  ] },
  { name: 'media.disable_presentation', mode: 'WRITE', parameters: [
    { name: 'placementKey', type: 'string', required: true }, { name: 'expectedRevision', type: 'string', required: true },
  ] },
  { name: 'media.delete', mode: 'WRITE', parameters: [
    { name: 'id', type: 'string', required: true }, { name: 'expectedVersion', type: 'integer', required: true },
  ] },
  { name: 'media.get_article', mode: 'READ', parameters: [
    { name: 'sourceType', type: 'string', required: true }, { name: 'sourceId', type: 'string', required: true },
  ] },
  ...['media.attach_to_article', 'media.detach_from_article'].map(name => ({ name, mode: 'WRITE', parameters: [
    { name: 'sourceType', type: 'string', required: true }, { name: 'sourceId', type: 'string', required: true },
    { name: 'id', type: 'string', required: true }, { name: 'expectedContentHash', type: 'string', required: true },
  ] })),
].map(tool => ({ ...tool, requiredRole: 'ADMIN', riskLevel: tool.mode === 'WRITE' ? 'HIGH' : 'LOW',
  confirmRequired: tool.mode === 'WRITE', dryRunSupported: false, description: 'Manage private video media' }));

test('public and lesser roles cannot discover or call media tools; admin writes require confirmation and key', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let calls = 0;
  globalThis.fetch = async (url, options) => {
    assert.match(url, /\/api\/tools\/media\.(get|delete)\/invoke$/);
    assert.equal(options.headers['X-Role'], 'ADMIN');
    calls += 1;
    return new Response(JSON.stringify({ status: 'DELETED', filesRetained: true }), { status: 200 });
  };
  for (const role of ['PUBLIC', 'VIEWER', 'EDITOR', 'PUBLISHER', 'ADMIN']) {
    const server = role === 'PUBLIC' ? createServer() : await createAdminServer({
      email: 'operator@example.com', role, owner: false,
    }, async () => catalog);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'media-test', version: '1.0.0' });
    await Promise.all([server.connect(b), client.connect(a)]);
    try {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      assert.equal(names.includes('media.get'), role === 'ADMIN');
      assert.equal(names.includes('media.delete'), role === 'ADMIN');
      for (const name of ['media.get_article', 'media.attach_to_article', 'media.detach_from_article',
        'media.get_presentation', 'media.set_presentation', 'media.disable_presentation'])
        assert.equal(names.includes(name), role === 'ADMIN');
      const read = await client.callTool({ name: 'media.get', arguments: { id: 'test-asset' } });
      assert.equal(read.isError === true, role !== 'ADMIN');
      const args = { id: 'test-asset', expectedVersion: 0, _idempotencyKey: 'media-delete-123' };
      const denied = await client.callTool({ name: 'media.delete', arguments: args });
      assert.equal(denied.isError, true);
      if (role === 'ADMIN') {
        const noKey = await client.callTool({ name: 'media.delete', arguments: {
          id: 'test-asset', expectedVersion: 0, _confirmed: true,
        } });
        assert.equal(noKey.isError, true);
        const success = await client.callTool({ name: 'media.delete', arguments: { ...args, _confirmed: true } });
        assert.notEqual(success.isError, true);
      }
    } finally { await client.close(); await server.close(); }
  }
  assert.equal(calls, 2);
});

test('article media tools forward IDs and body hash only after explicit confirmation', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    assert.equal(options.headers['X-Role'], 'ADMIN');
    return new Response(JSON.stringify({ mediaIds: ['00000000-0000-4000-8000-000000000001'] }), { status: 200 });
  };
  const server = await createAdminServer({ email: 'operator@example.com', role: 'ADMIN', owner: false }, async () => catalog);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'article-media-test', version: '1.0.0' });
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const args = { sourceType: 'PROJECT', sourceId: '00000000-0000-4000-8000-000000000002',
      id: '00000000-0000-4000-8000-000000000001', expectedContentHash: 'a'.repeat(64) };
    for (const name of ['media.attach_to_article', 'media.detach_from_article']) {
      assert.equal((await client.callTool({ name, arguments: args })).isError, true);
      assert.equal((await client.callTool({ name, arguments: { ...args, _confirmed: true } })).isError, true);
      const result = await client.callTool({ name, arguments: { ...args, _confirmed: true, _idempotencyKey: name + '-test-001' } });
      assert.notEqual(result.isError, true);
    }
    assert.equal(calls.length, 2);
    assert.match(calls[0].url, /media\.attach_to_article\/invoke$/);
    assert.match(calls[1].url, /media\.detach_from_article\/invoke$/);
    assert.ok(JSON.stringify(calls[0].body).includes(args.expectedContentHash));
  } finally { await client.close(); await server.close(); }
});

test('Chinese video intent discovers the admin media namespace', () => {
  const index = buildVisibleToolIndex(catalog);
  const result = searchToolIndex(index, { query: '删除视频', mode: 'WRITE' }, 'recommend');
  assert.equal(result.matches[0].name, 'media.delete');
});

test('homepage placement tools forward revision and chapters only after explicit confirmation', async t => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  const calls = [];
  globalThis.fetch = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    assert.equal(options.headers['X-Role'], 'ADMIN');
    return new Response(JSON.stringify({ enabled: true }), { status: 200 });
  };
  const server = await createAdminServer({ email: 'operator@example.com', role: 'ADMIN', owner: false }, async () => catalog);
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'intro-media-test', version: '1.0.0' });
  await Promise.all([server.connect(b), client.connect(a)]);
  try {
    const args = { placementKey: 'yuqi-intro', id: '00000000-0000-4000-8000-000000000001',
      expectedRevision: 'a'.repeat(64), chapters: [{ seconds: 0, title: 'Welcome' }] };
    assert.equal((await client.callTool({ name: 'media.set_presentation', arguments: args })).isError, true);
    assert.equal((await client.callTool({ name: 'media.set_presentation', arguments: { ...args, _confirmed: true } })).isError, true);
    assert.notEqual((await client.callTool({ name: 'media.set_presentation', arguments: { ...args,
      _confirmed: true, _idempotencyKey: 'intro-replace-001' } })).isError, true);
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /media\.set_presentation\/invoke$/);
    assert.ok(JSON.stringify(calls[0].body).includes(args.expectedRevision));
    assert.ok(JSON.stringify(calls[0].body).includes('Welcome'));
    const discovered = searchToolIndex(buildVisibleToolIndex(catalog), { query: '替换首页介绍视频', mode: 'WRITE' }, 'recommend');
    assert.equal(discovered.matches[0].name, 'media.set_presentation');
  } finally { await client.close(); await server.close(); }
});

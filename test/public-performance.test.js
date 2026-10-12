import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { withToolTimings, recordPhase, toolPhases } from '../src/tool-timings.js';

process.env.ADMIN_SERVICE_URL = 'https://audit.example.invalid';
process.env.ADMIN_SERVICE_INTERNAL_TOKEN = 'fixture-only';
const { recordToolCall } = await import('../src/operation-events.js');
const { createServer } = await import('../src/index.js');
const { tools } = await import('../src/tools.js');

test('public protocol results use compact JSON and never wait for audit HTTP', async t => {
  const log = t.mock.method(console, 'log', () => {});
  const http = t.mock.method(globalThis, 'fetch', async () => { throw new Error('public link reads need no HTTP'); });
  const context = { actor: 'mcp-server:public', traceId: 'a'.repeat(32), correlationId: 'private-user-input' };
  const server = createServer(context);
  const client = new Client({ name: 'performance-test', version: '1' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  const result = await client.callTool({ name: 'get_social_profiles', arguments: {} });
  assert.ok(!result.isError);
  const text = result.content[0].text;
  assert.equal(text, JSON.stringify(JSON.parse(text)));
  assert.equal(http.mock.callCount(), 0);
  const event = JSON.parse(log.mock.calls[0].arguments[0]);
  assert.equal(event.event, 'mcp.public_tool');
  assert.equal(event.status, 'completed');
  assert.equal(event.responseBytes, Buffer.byteLength(text));
  assert.equal(event.traceId, context.traceId);
  assert.equal(event.correlationId, undefined);
  assert.equal(event.actor, undefined);
});

test('admin operation audit stays awaited and keeps its central event contract', async t => {
  let release;
  let request;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    request = { url, init };
    await new Promise(resolve => { release = resolve; });
    return Response.json({ accepted: true });
  });
  const context = { actor: 'mcp-server:admin:owner@example.test', traceId: 'b'.repeat(32), correlationId: 'test' };
  let settled = false;
  const pending = recordToolCall({ context, toolName: 'publication.publish', status: 'completed', durationMs: 42 })
    .then(() => { settled = true; });
  assert.equal(settled, false);
  assert.match(request.url, /\/api\/internal\/operations\/events$/);
  const event = JSON.parse(request.init.body);
  assert.equal(event.eventType, 'mcp.tool.completed');
  assert.equal(event.actor.id, context.actor);
  release();
  await pending;
  assert.equal(settled, true);
});

test('public profile reads overlap and keep the same sanitized response', async t => {
  const waiting = [];
  t.mock.method(globalThis, 'fetch', (url, init) => new Promise(resolve => waiting.push({ url, init, resolve })));
  const pending = tools.find(tool => tool.name === 'get_profile').handler({});
  assert.equal(waiting.length, 2);
  for (const call of waiting) call.resolve(Response.json(String(call.url).includes('get_public_profile')
    ? { name: 'Yuqi', profileEvidence: [{ content: 'Approved public education' }] }
    : { items: [{ title: 'Current company', date: '2024 - Current' }, { title: 'Previous', date: '2022 - 2023' }] }));
  const profile = await pending;
  assert.equal(profile.name, 'Yuqi');
  assert.equal(profile.experience[0].period, '2024 - Current');
  assert.equal(profile.status, 'EVIDENCE_FOUND');
});

test('public read deadlines do not inherit the 40-second write budget', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  t.mock.method(globalThis, 'fetch', (_url, init) => new Promise((_resolve, reject) => {
    signal = init.signal;
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  }));
  const pending = tools.find(tool => tool.name === 'search_knowledge').handler({ query: 'education' });
  const rejected = assert.rejects(pending, /timed out after 8000ms/);
  t.mock.timers.tick(7999);
  assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await rejected;
});

test('concurrent tool timing contexts are isolated and bounded', async () => {
  const results = await Promise.all(['a', 'b'].map(label => withToolTimings(async () => {
    await new Promise(resolve => setImmediate(resolve));
    for (let i = 0; i < 20; i++) recordPhase(label, performance.now());
    return toolPhases();
  })));
  assert.ok(results.every(result => result.length === 12));
  assert.ok(results[0].every(result => result.phase === 'a'));
  assert.ok(results[1].every(result => result.phase === 'b'));
  assert.deepEqual(toolPhases(), []);
});

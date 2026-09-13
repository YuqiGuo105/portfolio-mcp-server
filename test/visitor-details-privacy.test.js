import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer, createAdminServer, createHttpServer } from '../src/index.js';

const catalog = ['visitor.search_events', 'visitor.get_session_events'].map(name => ({
  name, description: 'Private visitor event details', mode: 'READ', requiredRole: 'ADMIN',
  riskLevel: 'MEDIUM', confirmRequired: false,
  parameters: name.endsWith('session_events')
    ? [{ name: 'sessionId', type: 'string', required: true, minLength: 1, maxLength: 256 }]
    : [{ name: 'filter', type: 'object', required: false }, { name: 'window', type: 'object', required: false }],
}));

async function withClient(server, run) {
  const client = new Client({ name: 'visitor-privacy-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try { await run(client); } finally { await client.close(); await server.close(); }
}

test('public MCP neither advertises nor invokes visitor details, including a forged role argument', async () => {
  await withClient(createServer(), async client => {
    const names = (await client.listTools()).tools.map(tool => tool.name);
    for (const tool of catalog) {
      assert.ok(!names.includes(tool.name));
      const result = await client.callTool({ name: tool.name, arguments: { _mcpRole: 'ADMIN' } });
      assert.equal(result.isError, true);
      assert.ok(!JSON.stringify(result).includes('ipAddress'));
    }
  });
});

for (const role of ['VIEWER', 'EDITOR', 'PUBLISHER']) {
  test(`${role} cannot discover or call administrator visitor tools`, async () => {
    const server = await createAdminServer({ role, email: 'test@example.invalid', owner: false }, async () => catalog);
    await withClient(server, async client => {
      const names = (await client.listTools()).tools.map(tool => tool.name);
      for (const tool of catalog) {
        assert.ok(!names.includes(tool.name));
        const result = await client.callTool({ name: tool.name, arguments: { _mcpRole: 'ADMIN' } });
        assert.equal(result.isError, true);
      }
    });
  });
}

test('managed ADMIN, without owner privilege, receives private details via nested arguments', async t => {
  const seen = [];
  const expected = { items: [{ eventId: 'test-event', ipAddress: '192.0.2.10', sessionId: 'test-session' }],
    page: { number: 0, size: 25, totalElements: 1, totalPages: 1 } };
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    assert.match(url, /\/api\/tools\/visitor\.(search_events|get_session_events)\/invoke$/);
    assert.equal(options.headers['X-Role'], 'ADMIN');
    seen.push(JSON.parse(options.body));
    return new Response(JSON.stringify(expected), { headers: { 'Content-Type': 'application/json' } });
  });
  const server = await createAdminServer({ role: 'ADMIN', email: 'test@example.invalid', owner: false }, async () => catalog);
  await withClient(server, async client => {
    const tools = (await client.listTools()).tools;
    for (const tool of catalog) assert.ok(tools.some(item => item.name === tool.name && item.annotations.readOnlyHint));
    const args = { filter: { city: 'Dallas' }, window: { hours: 24 } };
    const result = await client.callTool({ name: 'visitor.search_events', arguments: args });
    assert.equal(result.isError, undefined);
    assert.deepEqual(JSON.parse(result.content[0].text), result.structuredContent);
    assert.deepEqual(result.structuredContent.page, expected.page);
    assert.equal(result.structuredContent.items[0].ipAddress, expected.items[0].ipAddress);
    assert.equal(result.structuredContent.trafficAnalysis.humanVerification, 'NOT_PERFORMED');
    const session = await client.callTool({ name: 'visitor.get_session_events', arguments: { sessionId: 'test-session' } });
    assert.equal(session.structuredContent.items[0].sessionId, 'test-session');
    assert.equal(session.structuredContent.trafficAnalysis.completeWindow, true);
    assert.deepEqual(seen, [args, { sessionId: 'test-session' }]);
  });
});

test('unauthenticated admin HTTP requests are rejected and never cached', async () => {
  const server = createHttpServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/mcp/admin`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('www-authenticate'), /^Bearer /);
    assert.ok(!(await response.text()).includes('ipAddress'));
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
});

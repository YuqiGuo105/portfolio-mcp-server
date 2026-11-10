import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';

test('public MCP discovers and calls architecture history without admin credentials', async t => {
  const fetchOriginal = globalThis.fetch;
  const history = process.env.ARCHITECTURE_PREVIEW_URL
    ? await (await fetchOriginal(`${process.env.ARCHITECTURE_PREVIEW_URL}/api/architecture/evolution`)).json()
    : { schemaVersion: 1, milestones: [{ id: 'outbox', type: 'decision', title: 'Transactional outbox' }] };
  const http = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://www.yuqi.site/api/architecture/evolution');
    return Response.json(history);
  });
  t.mock.method(console, 'log', () => {});
  const server = createServer();
  const client = new Client({ name: 'architecture-preview', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  const connecting = server.connect(b);
  await client.connect(a);
  await connecting;
  const catalog = await client.listTools();
  const tool = catalog.tools.find(item => item.name === 'get_architecture_evolution');
  assert.equal(tool.annotations.readOnlyHint, true);
  const response = await client.callTool({ name: tool.name, arguments: { type: 'decision', limit: 2 } });
  assert.ok(!response.isError);
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.status, 'FOUND');
  assert.ok(result.milestones.length <= 2);
  assert.ok(result.milestones.every(item => item.type === 'decision'));
  assert.equal(http.mock.callCount(), 1);
});

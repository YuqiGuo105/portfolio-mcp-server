import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAdminServer } from '../src/index.js';
import {
  buildVisibleToolIndex,
  searchToolIndex,
} from '../src/tool-discovery.js';

const searchTool = {
  name: 'admin.search_content',
  mode: 'READ',
  description: 'Search articles, projects, and portfolio content.',
  requiredRole: 'EDITOR',
  riskLevel: 'LOW',
  parameters: [{ name: 'keyword', type: 'string', required: true }],
};

const publishTool = {
  name: 'publication.publish',
  mode: 'WRITE',
  description: 'Publish a reviewed article and optionally notify subscribers.',
  requiredRole: 'PUBLISHER',
  riskLevel: 'HIGH',
  confirmRequired: true,
  parameters: [
    { name: 'contentId', type: 'string', required: true },
    { name: 'notifySubscribers', type: 'boolean', required: false },
  ],
};

const privateTool = {
  name: 'admin.list_admin_users',
  mode: 'READ',
  description: 'List managed administrator accounts.',
  requiredRole: 'ADMIN',
  riskLevel: 'HIGH',
  parameters: [],
};

test('search resolves exact, prefixed and natural-language tool requests', () => {
  const index = buildVisibleToolIndex([searchTool, publishTool]);
  const staleName = searchToolIndex(index, { query: 'mcp_vendor_admin_search_content' });
  assert.equal(staleName.matches[0].name, searchTool.name);
  assert.match(staleName.matches[0].schemaFingerprint, /^[a-f0-9]{16}$/);
  assert.deepEqual(staleName.matches[0].requiredInputs, ['keyword']);

  const recommendation = searchToolIndex(index, { query: '发布一篇文章并通知订阅者' }, 'recommend');
  assert.equal(recommendation.matches[0].name, publishTool.name);
  assert.equal(recommendation.matches[0].mode, 'WRITE');
  assert.deepEqual(recommendation.matches[0].callPattern.arguments, { contentId: '<contentId>' });

  const parameterSearch = searchToolIndex(index, { query: 'content id' });
  const parameterMatch = parameterSearch.matches.find(match => match.name === publishTool.name);
  assert.ok(parameterMatch?.matchReasons.includes('input schema'));
});

test('catalog tools search only the tools visible to the managed role', async () => {
  const server = await createAdminServer({
    email: 'editor@example.com',
    role: 'EDITOR',
    owner: false,
    operationContext: {
      traceId: 'a'.repeat(32),
      correlationId: 'catalog-scope-test',
      actor: 'mcp-server:admin:editor@example.com',
    },
  }, async () => [searchTool, publishTool, privateTool]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'catalog-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    assert.ok(listed.tools.some(tool => tool.name === 'catalog.search'));
    assert.ok(listed.tools.some(tool => tool.name === 'catalog.recommend'));

    const result = await client.callTool({
      name: 'catalog.search',
      arguments: { query: 'admin tools', limit: 20 },
    });
    const payload = result.structuredContent;
    assert.ok(payload.visibleToolCount >= 1);
    assert.ok(payload.matches.every(tool => tool.name !== publishTool.name));
    assert.ok(payload.matches.every(tool => tool.name !== privateTool.name));
  } finally {
    await client.close();
    await server.close();
  }
});

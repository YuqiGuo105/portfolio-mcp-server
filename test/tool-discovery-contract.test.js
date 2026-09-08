import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';

import { createServer } from '../src/index.js';

test('tool discovery advertises the canonical search name and rejects display-label aliases', async () => {
  const server = createServer();
  const client = new Client({ name: 'tool-discovery-contract-test', version: '1.0.0' });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const names = (await client.listTools()).tools.map(tool => tool.name);

    assert.ok(names.includes('search_portfolio'));
    assert.ok(names.includes('get_social_profiles'));
    assert.ok(!names.includes('Portfolio:search_portfolio'));
    assert.match(client.getInstructions(), /current tool registry/i);
    assert.match(client.getInstructions(), /Portfolio:search_portfolio/);
  } finally {
    await client.close();
    await server.close();
  }
});

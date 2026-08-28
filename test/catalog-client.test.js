import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import {
  annotationsForTool,
  inputSchemaForTool,
  loadToolCatalog,
  requiresExplicitConfirmation,
  resetCatalogCacheForTest,
  toolsForPrincipal,
} from '../src/catalog-client.js';
import { createAdminServer } from '../src/index.js';

const readTool = {
  name: 'admin.search_content',
  mode: 'READ',
  description: 'Search content',
  requiredRole: 'EDITOR',
  riskLevel: 'LOW',
  dryRunSupported: false,
  confirmRequired: false,
  parameters: [{ name: 'keyword', type: 'string', required: true, description: 'Query' }],
};

const writeTool = {
  name: 'admin.publish_content',
  mode: 'WRITE',
  description: 'Publish content',
  requiredRole: 'PUBLISHER',
  riskLevel: 'HIGH',
  dryRunSupported: true,
  confirmRequired: true,
  confirmationMethod: '',
  parameters: [
    { name: 'contentId', type: 'integer', required: true, description: 'Content ID' },
    { name: 'dryRun', type: 'boolean', required: false, description: 'Preview only' },
  ],
};

const ownerTool = {
  ...readTool,
  name: 'admin.list_admin_users',
  requiredRole: 'ADMIN',
};

test('loads and caches the canonical gateway catalog', async () => {
  process.env.MCP_GATEWAY_INTERNAL_TOKEN = 'test-token';
  resetCatalogCacheForTest();
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return new Response(JSON.stringify([readTool, writeTool]), { status: 200 });
  };
  const first = await loadToolCatalog({ fetchImpl });
  const second = await loadToolCatalog({ fetchImpl });
  assert.equal(first.length, 2);
  assert.equal(second, first);
  assert.equal(calls, 1);

  const stale = await loadToolCatalog({
    force: true,
    fetchImpl: async () => { throw new Error('gateway cold start'); },
  });
  assert.equal(stale, first);
});

test('filters tools by role and owner capability', () => {
  const catalog = [readTool, writeTool, ownerTool];
  assert.deepEqual(toolsForPrincipal(catalog, { role: 'EDITOR', owner: false }).map(t => t.name), [readTool.name]);
  assert.deepEqual(toolsForPrincipal(catalog, { role: 'PUBLISHER', owner: false }).map(t => t.name), [readTool.name, writeTool.name]);
  assert.deepEqual(toolsForPrincipal(catalog, { role: 'ADMIN', owner: false }).map(t => t.name), [readTool.name, writeTool.name]);
  assert.deepEqual(toolsForPrincipal(catalog, { role: 'ADMIN', owner: true }).map(t => t.name), [readTool.name, writeTool.name, ownerTool.name]);
});

test('adds confirmation, dry-run and idempotency controls to write tools', () => {
  const schema = inputSchemaForTool(writeTool);
  assert.deepEqual(Object.keys(schema), ['contentId', 'dryRun', '_confirmed', '_idempotencyKey']);
  assert.deepEqual(annotationsForTool(writeTool), {
    readOnlyHint: false,
    destructiveHint: true,
    idempotentHint: true,
    openWorldHint: false,
  });
  assert.equal(requiresExplicitConfirmation(writeTool, {}), true);
  assert.equal(requiresExplicitConfirmation(writeTool, { _confirmed: true }), false);
  assert.equal(requiresExplicitConfirmation(writeTool, { dryRun: true }), false);
  assert.equal(requiresExplicitConfirmation({ ...writeTool, confirmationMethod: 'email_otp' }, {}), false);
});

test('admin MCP lists role-scoped catalog tools and blocks unconfirmed writes', async () => {
  const authContext = {
    email: 'publisher@example.com',
    role: 'PUBLISHER',
    owner: false,
    operationContext: {
      traceId: 'a'.repeat(32),
      correlationId: 'test-correlation',
      actor: 'mcp-server:admin:publisher@example.com',
    },
  };
  const server = await createAdminServer(authContext, async () => [readTool, writeTool, ownerTool]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test-client', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const listed = await client.listTools();
    const names = listed.tools.map(tool => tool.name);
    assert.ok(names.includes(readTool.name));
    assert.ok(names.includes(writeTool.name));
    assert.ok(!names.includes(ownerTool.name));
    const published = listed.tools.find(tool => tool.name === writeTool.name);
    assert.equal(published.annotations.destructiveHint, true);
    assert.equal(published.annotations.idempotentHint, true);

    const result = await client.callTool({ name: writeTool.name, arguments: { contentId: 42 } });
    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /confirmation is required/i);
  } finally {
    await client.close();
    await server.close();
  }
});

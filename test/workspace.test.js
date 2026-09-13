import test from 'node:test';
import assert from 'node:assert/strict';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { registerWorkspace, retryTickets, WORKSPACE_URI } from '../src/workspace.js';
import { createServer, createAdminServer } from '../src/index.js';
import { catalog, fixture } from '../e2e/fixtures.mjs';

const principal = { role: 'ADMIN', email: 'admin@example.test', sub: 'owner-1' };
const secret = 'workspace-fixture-signing-key-not-production';
async function setup(t, role = 'ADMIN', execute = async (tool, args) => ({ structuredContent: fixture(tool.name, args) })) {
  const server = new McpServer({ name: 'workspace-test', version: '1' });
  registerWorkspace(server, { ...principal, role }, catalog, execute, { secret });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '1' });
  await Promise.all([server.connect(b), client.connect(a)]);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
test('workspace resources and tools are registered only for ADMIN', async t => {
  for (const role of ['ADMIN', 'PUBLISHER', 'EDITOR', 'VIEWER']) {
    const server = await createAdminServer({ ...principal, role }, async () => catalog);
    const [a, b] = InMemoryTransport.createLinkedPair();
    const client = new Client({ name: 'rbac-test', version: '1' });
    await Promise.all([server.connect(b), client.connect(a)]);
    const names = (await client.listTools()).tools.map(x => x.name);
    assert.equal(names.includes('workspace.open_view'), role === 'ADMIN');
    if (role !== 'ADMIN') assert.equal((await client.callTool({ name: 'workspace.get_view_data', arguments: {} })).isError, true);
    await client.close(); await server.close();
  }
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'public-test', version: '1' });
  await Promise.all([server.connect(b), client.connect(a)]);
  assert.ok(!(await client.listTools()).tools.some(x => x.name.startsWith('workspace.')));
  await assert.rejects(client.readResource({ uri: WORKSPACE_URI }));
  await client.close(); await server.close();
});
test('resource is self-contained, versioned, and credential-free', async t => {
  const client = await setup(t);
  const tools = (await client.listTools()).tools;
  assert.equal(tools.find(x => x.name === 'workspace.open_view')._meta.ui.resourceUri, WORKSPACE_URI);
  assert.equal(tools.find(x => x.name === 'workspace.get_view_data')._meta.ui.resourceUri, undefined);
  assert.deepEqual(tools.find(x => x.name === 'workspace.confirm_retry')._meta.ui.visibility, ['app']);
  const resource = (await client.readResource({ uri: WORKSPACE_URI })).contents[0];
  assert.equal(resource.mimeType, 'text/html;profile=mcp-app');
  assert.deepEqual(resource._meta.ui.csp, { connectDomains: [], resourceDomains: [] });
  assert.ok(!resource.text.includes(secret));
  assert.ok(!resource.text.includes('admin@example.test'));
});
test('private records stay in widget metadata, queries are bounded, admin visits excluded', async t => {
  let received;
  const client = await setup(t, 'ADMIN', async (tool, args) => { received = args; return { structuredContent: fixture(tool.name, args) }; });
  const result = await client.callTool({ name: 'workspace.open_view', arguments: { view: 'visitors', filter: { city: 'Dallas' } } });
  assert.equal(result.isError, undefined);
  assert.equal(received.filter.includeAdmin, false);
  assert.equal(received.page.size, 15);
  assert.ok(received.window.from && received.window.to);
  assert.equal(result.structuredContent.count, 15);
  assert.ok(!JSON.stringify(result.structuredContent).includes('fixture-session'));
  assert.equal(result._meta.workspace.items[0].sessionId, 'fixture-session-1');
  assert.equal(result._meta.workspace.items[0].ipAddress, undefined);
  for (const args of [{ page: { size: 1000 } }, { filter: { includeAdmin: true } }, { window: { from: 'bad', to: 'bad' } }]) {
    assert.equal((await client.callTool({ name: 'workspace.get_view_data', arguments: args })).isError, true);
  }
});
test('paging preserves fixed window and unsupported detail reads fail closed', async t => {
  const client = await setup(t);
  const first = await client.callTool({ name: 'workspace.open_view', arguments: { view: 'visitors' } });
  const second = await client.callTool({ name: 'workspace.get_view_data', arguments: { view: 'visitors', window: first._meta.workspace.window, page: { number: 1, size: 15 } } });
  assert.equal(second._meta.workspace.items.length, 3);
  assert.equal(second._meta.workspace.hasMore, false);
  assert.deepEqual(second._meta.workspace.window, first._meta.workspace.window);
  assert.equal((await client.callTool({ name: 'workspace.get_item', arguments: { view: 'visitors', id: 'session' } })).isError, true);
});
test('knowledge and operations render data; partial failures are explicit', async t => {
  const client = await setup(t, 'ADMIN', async (tool, args) => tool.name === 'operation.list' ? { isError: true, structuredContent: {} } : { structuredContent: fixture(tool.name, args) });
  const result = await client.callTool({ name: 'workspace.open_view', arguments: { view: 'operations' } });
  assert.equal(result.structuredContent.status, 'partial');
  assert.deepEqual(result._meta.workspace.unavailable, ['operations']);
  const kb = await client.callTool({ name: 'workspace.get_view_data', arguments: { view: 'knowledge' } });
  assert.equal(kb._meta.workspace.items[0].title, 'Platform architecture');
});
test('review requires a current failed task and never performs a write', async t => {
  const calls = [];
  const client = await setup(t, 'ADMIN', async (tool, args) => { calls.push([tool.name, args]); return { structuredContent: fixture(tool.name, args) }; });
  const result = await client.callTool({ name: 'workspace.prepare_retry', arguments: { kind: 'INDEXING_JOB', id: 'index-42' } });
  assert.equal(result.structuredContent.status, 'confirmation_required');
  assert.equal(calls.length, 1);
  const ticket = result._meta.workspace.review.ticket;
  assert.equal((await client.callTool({ name: 'workspace.confirm_retry', arguments: { ticket, confirmed: false } })).isError, true);
  const args = { ticket, confirmed: true };
  await client.callTool({ name: 'workspace.confirm_retry', arguments: args });
  await client.callTool({ name: 'workspace.confirm_retry', arguments: args });
  assert.deepEqual(calls[1], calls[2]);
  assert.equal(calls[1][1]._confirmed, true);
  assert.equal((await client.callTool({ name: 'workspace.prepare_retry', arguments: { kind: 'INDEXING_JOB', id: 'not-found' } })).isError, true);
});
test('tickets reject tampering, other admins and expiry', () => {
  let clock = 1000;
  const tickets = retryTickets(principal, { secret, now: () => clock });
  const review = tickets.issue({ kind: 'INDEXING_JOB', id: '42' });
  assert.equal(tickets.verify(review.ticket).action.id, '42');
  assert.throws(() => tickets.verify(review.ticket + 'tampered'));
  assert.throws(() => retryTickets({ ...principal, sub: 'other' }, { secret, now: () => clock }).verify(review.ticket));
  clock += 300001;
  assert.throws(() => tickets.verify(review.ticket));
});
test('uncertain write response never claims success or retries', async t => {
  let writes = 0;
  const client = await setup(t, 'ADMIN', async (tool, args) => {
    if (tool.mode === 'WRITE') { writes++; throw new Error('timeout'); }
    return { structuredContent: fixture(tool.name, args) };
  });
  const prepared = await client.callTool({ name: 'workspace.prepare_retry', arguments: { kind: 'INDEXING_JOB', id: 'index-42' } });
  const result = await client.callTool({ name: 'workspace.confirm_retry', arguments: { ticket: prepared._meta.workspace.review.ticket, confirmed: true } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 'verify_required');
  assert.equal(result.structuredContent.safeToRetry, false);
  assert.equal(writes, 1);
});
test('HTTP success with an uncertain operation is not retry acceptance', async t => {
  const client = await setup(t, 'ADMIN', async (tool, args) => ({ structuredContent: tool.mode === 'WRITE'
    ? { operation: { state: 'UNKNOWN', ambiguousOutcome: true } } : fixture(tool.name, args) }));
  const prepared = await client.callTool({ name: 'workspace.prepare_retry', arguments: { kind: 'INDEXING_JOB', id: 'index-42' } });
  const result = await client.callTool({ name: 'workspace.confirm_retry', arguments: { ticket: prepared._meta.workspace.review.ticket, confirmed: true } });
  assert.equal(result.isError, true);
  assert.equal(result.structuredContent.status, 'verify_required');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { z } from 'zod';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../src/index.js';
import { createToolRegistry, schemaHash, registryFor } from '../src/tool-registry.js';
import { createOAuthProbe, diagnoseConnection, registerConnectionCheck } from '../src/connection-diagnostics.js';

async function connect(t, server) {
  const client = new Client({ name: 'connection-test', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b); await client.connect(a);
  t.after(async () => { await client.close(); await server.close(); });
  return client;
}
const metadata = { issuer: 'https://auth.example.test/auth/v1', authorization_endpoint: 'https://auth.example.test/auth/v1/authorize',
  token_endpoint: 'https://auth.example.test/auth/v1/token', registration_endpoint: 'https://auth.example.test/auth/v1/register',
  response_types_supported: ['code'], code_challenge_methods_supported: ['S256'] };
const response = value => new Response(JSON.stringify(value), { headers: { 'Content-Type': 'application/json' } });

test('public self-check finds stale display labels without revealing private tools', async t => {
  const client = await connect(t, createServer());
  const result = await client.callTool({ name: 'connection.check', arguments: { locale: 'zh',
    invocations: [{ name: 'Portfolio:search_portfolio' }, { name: 'workspace.get_item', arguments: { id: 'private-secret' } }] } });
  assert.equal(result.structuredContent.status, 'fail');
  assert.deepEqual(result.structuredContent.toolChecks[0].protocolCandidates, ['search_portfolio']);
  assert.deepEqual(result.structuredContent.toolChecks[1].protocolCandidates, []);
  assert.equal(result.structuredContent.toolChecks[1].code, 'tool_not_available');
  assert.ok(!JSON.stringify(result).includes('private-secret'));
  assert.ok(!JSON.stringify(result).includes('workspace.get_item'));
  assert.match(result.content[0].text, /REFRESH_TOOL_DISCOVERY/);
});

test('schemas match tools/list; validation never executes the target handler', async t => {
  let calls = 0;
  const server = new McpServer({ name: 'schema-check', version: '1' });
  const registry = createToolRegistry(server);
  const registered = registry.registerTool('example.write', { inputSchema: { value: z.string().min(2), page: z.object({ size: z.number().int().max(25) }).optional() } }, () => { calls++; });
  registerConnectionCheck(registry, { surface: 'public' });
  const client = await connect(t, server);
  const schema = (await client.listTools()).tools.find(t => t.name === 'example.write').inputSchema;
  const result = await client.callTool({ name: 'connection.check', arguments: { invocations: [
    { name: 'example.write', schemaHash: schemaHash(schema), arguments: { value: 'secret-value' } },
    { name: 'example.write', schemaHash: '0'.repeat(64), arguments: { value: 'secret-value' } },
    { name: 'example.write', arguments: { value: 'x', page: { size: 1000 } } },
    { name: 'example.write', arguments: { value: 'valid', password: 'do-not-echo' } },
  ] } });
  const checks = result.structuredContent.toolChecks;
  assert.equal(checks[0].status, 'pass');
  assert.equal(checks[0].schemaHash, schemaHash(schema));
  assert.equal(checks[1].code, 'schema_stale');
  assert.equal(checks[2].code, 'arguments_invalid');
  assert.equal(checks[3].code, 'arguments_ignored');
  assert.equal(calls, 0);
  assert.ok(!JSON.stringify(result).includes('secret-value'));
  assert.ok(!JSON.stringify(result).includes('do-not-echo'));
  registered.disable();
  assert.ok(!registry.entries().some(d => d.name === 'example.write'));
});

test('batch and sample payload bounds reject oversized diagnostics', async t => {
  const client = await connect(t, createServer());
  for (const args of [{ invocations: Array.from({ length: 11 }, () => ({ name: 'get_profile' })) },
    { invocations: [{ name: 'get_profile', arguments: { x: 'x'.repeat(17000) } }] }, { token: 'never-accepted' }]) {
    assert.equal((await client.callTool({ name: 'connection.check', arguments: args })).isError, true);
  }
});

test('unknown client protocol and missing information are not a verified compatibility pass', async t => {
  const server = createServer(); t.after(() => server.close());
  const result = await diagnoseConnection({ client: { protocolVersion: '2099-01-01', schemaDialect: 'draft-2020-12', supportsMcpApps: false } }, { registry: registryFor(server) });
  assert.equal(result.status, 'fail');
  assert.ok(result.checks.some(c => c.code === 'protocol_unsupported'));
  assert.ok(result.checks.some(c => c.code === 'text_fallback'));
});
test('reported registration failures and unavailable catalogs are not treated as healthy', async t => {
  const server = createServer(); t.after(() => server.close());
  const result = await diagnoseConnection({ locale: 'zh', client: { observedFailure: { phase: 'registration', httpStatus: 400 } },
    invocations: [{ name: 'get_profile' }] }, { registry: registryFor(server), catalogAvailable: false });
  assert.equal(result.status, 'fail');
  assert.equal(result.checks.find(c => c.id === 'client_observation').evidence.source, 'client_reported');
  assert.equal(result.checks.find(c => c.id === 'catalog').code, 'catalog_unavailable');
  assert.equal(result.toolChecks[0].status, 'skip');
});

test('OAuth discovery is read-only, cached, issuer-bound and does not follow redirects', async () => {
  let requests = 0;
  const probe = createOAuthProbe({ fetchImpl: async (url, init) => {
    requests++; assert.equal(init.redirect, 'manual'); assert.ok(!init.method || init.method === 'GET');
    assert.ok(!init.headers.Authorization); return response(metadata);
  } });
  const first = await probe(metadata.issuer);
  assert.equal(first.status, 'pass');
  assert.equal(first.registrationAdvertised, true);
  await probe(metadata.issuer); assert.equal(requests, 1);
  assert.equal((await createOAuthProbe({ fetchImpl: async () => response({ ...metadata, issuer: 'https://wrong.test' }) })(metadata.issuer)).code, 'oauth_metadata_invalid');
  assert.equal((await createOAuthProbe({ fetchImpl: async () => response({ ...metadata, code_challenge_methods_supported: ['plain'] }) })(metadata.issuer)).code, 'pkce_s256_missing');
  assert.equal((await createOAuthProbe({ fetchImpl: async () => new Response(null, { status: 302, headers: { Location: 'http://127.0.0.1/private' } }) })(metadata.issuer)).status, 'fail');
});

test('OAuth timeout, oversized metadata and unsafe issuer fail boundedly', async () => {
  const timeout = createOAuthProbe({ timeoutMs: 5, fetchImpl: async (_, init) => new Promise((_, reject) => {
    init.signal.addEventListener('abort', () => reject(new Error('aborted')));
  }) });
  assert.equal((await timeout(metadata.issuer)).code, 'oauth_discovery_timeout');
  const oversized = createOAuthProbe({ fetchImpl: async () => response({ ...metadata, unused: 'x'.repeat(70000) }) });
  assert.equal((await oversized(metadata.issuer)).status, 'fail');
  const unsafe = createOAuthProbe({ fetchImpl: () => { assert.fail('Unsafe issuer must not be fetched'); } });
  assert.equal((await unsafe('http://169.254.169.254/')).code, 'oauth_not_configured');
});

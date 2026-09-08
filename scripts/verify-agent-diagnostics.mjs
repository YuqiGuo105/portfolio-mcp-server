import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';

// Explicit operator-run, read-only production smoke. Credentials stay in memory.
const endpoint = new URL(process.env.MCP_DIAGNOSTICS_URL || 'https://www.yuqi.site/mcp/admin');
const runId = process.env.MCP_DIAGNOSTICS_RUN_ID;
assert.match(runId || '', /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
assert.equal(endpoint.protocol, 'https:');
const denied = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
assert.equal(denied.status, 401);
assert.match(denied.headers.get('www-authenticate') || '', /resource_metadata/);
console.log('PASS unauthenticated request requires OAuth');

const state = randomBytes(24).toString('hex');
let resolveCode;
let rejectCode;
const callbackCode = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
const callback = createServer((req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  if (url.pathname !== '/callback' || url.searchParams.get('state') !== state) {
    res.writeHead(400).end('Invalid OAuth callback'); return;
  }
  if (!url.searchParams.get('code') || url.searchParams.has('error')) {
    res.writeHead(400).end('Authorization was not completed');
    rejectCode(new Error('Authorization was not completed')); return;
  }
  res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' })
    .end('Authorization received. You can return to Codex.');
  resolveCode(url.searchParams.get('code'));
});
await new Promise(resolve => callback.listen(0, '127.0.0.1', resolve));
const redirectUrl = `http://127.0.0.1:${callback.address().port}/callback`;
let clientInfo, tokens, verifier;
const provider = {
  redirectUrl,
  clientMetadata: { client_name: 'Yuqi read-only diagnostics verification', redirect_uris: [redirectUrl],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'],
    token_endpoint_auth_method: 'none', scope: 'email profile' },
  state: () => state,
  clientInformation: () => clientInfo,
  saveClientInformation: value => { clientInfo = value; },
  tokens: () => tokens,
  saveTokens: value => { tokens = value; },
  saveCodeVerifier: value => { verifier = value; },
  codeVerifier: () => verifier,
  redirectToAuthorization: url => console.log(`AUTHORIZE ${url.href}`),
};
const loginTimeout = setTimeout(() => rejectCode(new Error('Administrator login timed out')), 600_000);
let client;
try {
  const result = await auth(provider, { serverUrl: endpoint, scope: 'email profile' });
  if (result === 'REDIRECT') {
    await auth(provider, { serverUrl: endpoint, authorizationCode: await callbackCode, scope: 'email profile' });
  }
  clearTimeout(loginTimeout);
  callback.close();
  console.log('PASS OAuth authorization completed; verifying managed administrator role');
  client = new Client({ name: 'yuqi-diagnostics-smoke', version: '1.0.0' });
  await client.connect(new StreamableHTTPClientTransport(endpoint, { authProvider: provider }));
  const expected = ['agent.search_runs', 'agent.get_run_diagnostics'];
  let names = [];
  const attempts = process.argv.includes('--wait-for-deployment') ? 30 : 1;
  for (let attempt = 0; attempt < attempts; attempt++) {
    names = (await client.listTools()).tools.map(tool => tool.name);
    if (expected.every(name => names.includes(name))) break;
    if (attempt === 0) console.log('WAIT diagnostics catalog deployment');
    if (attempt + 1 < attempts) await new Promise(resolve => setTimeout(resolve, 60_000));
  }
  assert.ok(expected.every(name => names.includes(name)), 'Admin diagnostics tools are unavailable');
  function data(result) {
    assert.notEqual(result.isError, true, 'MCP tool returned an error');
    return JSON.parse(result.content.find(item => item.type === 'text').text);
  }
  const runs = data(await client.callTool({ name: expected[0], arguments: { q: runId, hours: 720, limit: 1 } }));
  assert.ok(runs.items?.some(run => run.runId === runId), 'Known run missing from database search');
  const diagnostics = data(await client.callTool({ name: expected[1], arguments: { runId } }));
  assert.equal(diagnostics.runId, runId);
  assert.equal(diagnostics.found, true);
  assert.equal(diagnostics.storage, 'outbox_event');
  assert.ok(diagnostics.eventCount > 0);
  console.log(JSON.stringify({ result: 'PASS', transport: 'OAuth -> MCP -> Gateway -> Agent -> PostgreSQL',
    runId, events: diagnostics.eventCount, signals: diagnostics.signals }));
} finally {
  clearTimeout(loginTimeout);
  callback.close();
  await client?.close();
  tokens = undefined; verifier = undefined; clientInfo = undefined;
}

import assert from 'node:assert/strict';
import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { chromium, expect } from '@playwright/test';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { auth } from '@modelcontextprotocol/sdk/client/auth.js';
import { registerWorkspace, workspaceHtml, WORKSPACE_URI } from '../src/workspace.js';

// Operator-run live smoke: browser OAuth, memory-only credentials, read-only
// allowlists on both sides of the host bridge, and no production retry execution.
const endpoint = new URL(process.env.MCP_WORKSPACE_URL || 'https://www.yuqi.site/mcp/admin');
assert.equal(endpoint.protocol, 'https:');
const reads = new Set(['visitor.search_events', 'visitor.get_session_events', 'knowledge.list', 'knowledge.get',
  'operation.list', 'operation.get_timeline', 'admin.list_failed_operations']);
const appReads = new Set(['workspace.open_view', 'workspace.get_view_data', 'workspace.get_item']);
const nonce = randomBytes(24).toString('hex');
let resolveCode, rejectCode, selectedClient, clientInfo, tokens, verifier;
const code = new Promise((resolve, reject) => { resolveCode = resolve; rejectCode = reject; });
const bundle = await build({ entryPoints: ['e2e/host.js'], bundle: true, format: 'esm', write: false });
const json = (res, data, status = 200) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(data)); };
const host = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://127.0.0.1');
    if (url.pathname === '/callback') {
      assert.equal(url.searchParams.get('state'), nonce);
      assert.ok(url.searchParams.get('code'));
      resolveCode(url.searchParams.get('code'));
      return res.writeHead(200, { 'Content-Type': 'text/plain', 'Cache-Control': 'no-store' }).end('Authorization received. You may return to Codex.');
    }
    const authorized = req.headers.cookie === `workspace_smoke=${nonce}`;
    if (url.pathname === `/start/${nonce}`) {
      res.writeHead(302, { Location: '/', 'Set-Cookie': `workspace_smoke=${nonce}; HttpOnly; SameSite=Strict; Path=/`, 'Cache-Control': 'no-store' }).end(); return;
    }
    if (!authorized) return json(res, { error: { message: 'Unauthorized' } }, 401);
    if (url.pathname === '/host/rpc') {
      assert.equal(req.method, 'POST');
      assert.equal(req.headers.origin, `http://127.0.0.1:${host.address().port}`);
      let body = '';
      for await (const chunk of req) { body += chunk; assert.ok(body.length <= 32000); }
      const { method, params } = JSON.parse(body);
      let result;
      if (method === 'resources/read' && params.uri === WORKSPACE_URI) result = await selectedClient.readResource(params);
      else if (method === 'tools/call' && appReads.has(params.name)) result = await selectedClient.callTool(params, undefined, { timeout: 60000 });
      else throw new Error('Live verification is read-only');
      return json(res, { result });
    }
    if (url.pathname === '/host.js') return res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' }).end(bundle.outputFiles[0].text);
    res.writeHead(200, { 'Content-Type': 'text/html', 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"><title>Private MCP Workspace Verification</title></head><body style="margin:0;background:#eef1f2;font:14px system-ui"><div style="max-width:900px;margin:20px auto"><p>Authenticated live data · read-only verification <button id="theme">Dark theme</button></p><iframe id="app" title="Admin workspace" sandbox="allow-scripts" style="width:100%;height:780px;border:1px solid #dde4e4;border-radius:8px"></iframe></div><script type="module" src="/host.js"></script></body></html>');
  } catch { json(res, { error: { message: 'Verification request failed' } }, 400); }
});
await new Promise(resolve => host.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${host.address().port}`;
const provider = {
  redirectUrl: `${base}/callback`, state: () => nonce,
  clientMetadata: { client_name: 'Yuqi Workspace read-only E2E verification', redirect_uris: [`${base}/callback`],
    grant_types: ['authorization_code', 'refresh_token'], response_types: ['code'], token_endpoint_auth_method: 'none', scope: 'email profile' },
  clientInformation: () => clientInfo, saveClientInformation: v => { clientInfo = v; },
  tokens: () => tokens, saveTokens: v => { tokens = v; }, codeVerifier: () => verifier, saveCodeVerifier: v => { verifier = v; },
  redirectToAuthorization: url => console.log(`AUTHORIZE ${url.href}`),
};
const loginTimeout = setTimeout(() => rejectCode(new Error('Administrator login timed out')), 600000);
let remote, local, server, browser;
try {
  const denied = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
  if (await auth(provider, { serverUrl: endpoint, scope: 'email profile' }) === 'REDIRECT') {
    await auth(provider, { serverUrl: endpoint, authorizationCode: await code, scope: 'email profile' });
  }
  clearTimeout(loginTimeout);
  remote = new Client({ name: 'yuqi-workspace-live-verification', version: '1.0.0' });
  await remote.connect(new StreamableHTTPClientTransport(endpoint, { authProvider: provider }));
  const registered = (await remote.listTools()).tools;
  assert.ok([...reads].every(name => registered.some(t => t.name === name)), 'Managed ADMIN tools required');
  console.log('PASS real OAuth and administrator tool discovery');
  server = new McpServer({ name: 'workspace-candidate-live', version: '1' });
  const catalog = registered.filter(t => reads.has(t.name)).map(t => ({ name: t.name, mode: 'READ', confirmRequired: false,
    parameters: Object.entries(t.inputSchema.properties || {}).map(([name, s]) => ({ name, type: s.type || 'object', required: t.inputSchema.required?.includes(name) === true })) }));
  registerWorkspace(server, { role: 'ADMIN', email: 'oauth-smoke@example.test' }, catalog, async (tool, args) => {
    assert.ok(reads.has(tool.name));
    return remote.callTool({ name: tool.name, arguments: args }, undefined, { timeout: 60000 });
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  local = new Client({ name: 'workspace-candidate-client', version: '1' });
  await server.connect(b); await local.connect(a);
  browser = await chromium.launch({ channel: process.env.E2E_CHROME ? 'chrome' : undefined });
  const context = await browser.newContext();
  await context.addCookies([{ name: 'workspace_smoke', value: nonce, url: base, httpOnly: true, sameSite: 'Strict' }]);
  async function verify(client, label) {
    selectedClient = client;
    const page = await context.newPage();
    const errors = []; page.on('pageerror', e => errors.push(e.message));
    try {
      await page.goto(base);
      const ui = page.frameLocator('#app');
      for (const [view, title] of [['visitors', 'Visitor activity'], ['operations', 'Operations'], ['knowledge', 'Knowledge base']]) {
        if (view !== 'visitors') await ui.getByRole('tab', { name: title, exact: true }).click();
        await expect(ui.locator('.updated')).toContainText('Updated', { timeout: 90000 });
        await expect(ui.getByRole('alert')).toHaveCount(0);
        const count = await ui.locator('.record').count();
        assert.ok(count > 0, `${view}: expected known live records`);
        await ui.locator('.record').first().click();
        await expect(ui.getByText('Loading details...', { exact: true })).toHaveCount(0, { timeout: 90000 });
        await expect(ui.getByRole('alert')).toHaveCount(0);
        if (view === 'knowledge') await expect(ui.locator('.source-content')).not.toHaveText('Content unavailable');
        else assert.ok(await ui.locator('.timeline li').count() > 0, `${view}: expected persisted timeline`);
        await ui.getByRole('button', { name: 'Close details' }).click();
        console.log(`PASS ${label} Chrome ${view}: ${count} real records; detail verified`);
      }
      assert.deepEqual(errors, []);
    } finally { await page.close(); }
  }
  await verify(local, 'candidate');
  if (process.argv.includes('--wait-for-deployment')) {
    console.log('WAIT production deployment; credentials remain in memory; no writes will run');
    const expectedHtml = await workspaceHtml();
    let deployed = false;
    for (let attempt = 0; attempt < 90; attempt++) {
      try {
        const resource = await remote.readResource({ uri: WORKSPACE_URI });
        if (resource.contents[0]?.text === expectedHtml) { deployed = true; break; }
      } catch { /* Resource is intentionally unavailable before deployment. */ }
      await new Promise(resolve => setTimeout(resolve, 30000));
    }
    assert.ok(deployed, 'Deployment not observed before verification deadline');
    await verify(remote, 'production');
    const publicClient = new Client({ name: 'workspace-public-check', version: '1' });
    try {
      const url = new URL(endpoint); url.pathname = url.pathname.replace(/\/admin$/, '');
      await publicClient.connect(new StreamableHTTPClientTransport(url));
      assert.ok(!(await publicClient.listTools()).tools.some(t => t.name.startsWith('workspace.')));
      await assert.rejects(publicClient.readResource({ uri: WORKSPACE_URI }));
    } finally { await publicClient.close(); }
    console.log('PASS production public endpoint cannot discover workspace tools or read resource');
  }
  console.log('PASS live verification complete; production writes: 0');
} finally {
  clearTimeout(loginTimeout); await browser?.close(); await local?.close(); await server?.close(); await remote?.close();
  host.closeAllConnections(); host.close(); tokens = verifier = clientInfo = undefined;
}

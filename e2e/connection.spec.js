import { test, expect } from '@playwright/test';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

test.beforeEach(async ({ request }) => { await request.post('/host/control', { data: {} }); });
test('OAuth failure report is reachable without a working MCP login', async ({ request }) => {
  const response = await request.get('/host/diagnostics');
  expect(response.status()).toBe(401);
  expect(response.headers()['cache-control']).toContain('no-store');
  const report = await response.json();
  expect(report.checks.find(c => c.id === 'session').code).toBe('session_required');
  expect(report.checks.find(c => c.id === 'oauth_discovery').code).toBe('oauth_discovery_ready');
  expect(report.checks.find(c => c.id === 'catalog').status).toBe('skip');
  expect(JSON.stringify(report)).not.toContain('workspace.open_view');
  expect(report.markdown).toContain('RECONNECT_OAUTH');
});
test('expired, tampered, forbidden and unavailable auth produce distinct recovery advice', async ({ request }) => {
  for (const [session, status, code] of [['expired', 401, 'session_expired'], ['invalid', 401, 'token_invalid'], ['outsider', 403, 'admin_access_denied']]) {
    const response = await request.get(`/host/diagnostics?session=${session}`);
    expect(response.status()).toBe(status);
    const report = await response.json();
    expect(report.checks.find(c => c.id === 'session').code).toBe(code);
    expect(report.toolChecks).toEqual([]);
    expect(JSON.stringify(report)).not.toContain('@example.test');
  }
  await request.post('/host/control', { data: { mode: 'auth-down' } });
  const unavailable = await request.get('/host/diagnostics?session=valid');
  expect(unavailable.status()).toBe(503);
  const session = (await unavailable.json()).checks.find(c => c.id === 'session');
  expect(session.code).toBe('auth_service_unavailable');
  expect(session.nextAction).toBe('RETRY_LATER');
});
test('authenticated batch checks use role-scoped schemas without executing writes', async ({ request }) => {
  const response = await request.post('/host/diagnostics?session=valid', { data: { locale: 'zh',
    client: { protocolVersion: '2025-11-25', schemaDialect: 'draft-7' }, invocations: [
      { name: 'workspace.confirm_retry', arguments: { ticket: 'not-a-real-ticket-but-long-enough', confirmed: true } },
      { name: 'workspace.get_view_data', arguments: { page: { size: 1000 } } },
      { name: 'workspace.get_item', schemaHash: '0'.repeat(64), arguments: { id: 'test', view: 'knowledge' } },
    ] } });
  expect(response.status()).toBe(200);
  const report = await response.json();
  expect(report.toolChecks[0].status).toBe('pass');
  expect(report.toolChecks[0].executed).toBe(false);
  expect(report.toolChecks[1].code).toBe('arguments_invalid');
  expect(report.toolChecks[2].code).toBe('schema_stale');
  expect(JSON.stringify(report)).not.toContain('not-a-real-ticket');
  expect((await (await request.get('/host/state')).json()).writes).toBe(0);
});
test('real MCP transport returns a readable connection report and current tool-name suggestions', async ({ request }) => {
  const response = await request.post('/host/rpc', { data: { method: 'tools/call', params: { name: 'connection.check',
    arguments: { locale: 'zh', client: { protocolVersion: '2025-11-25' }, invocations: [{ name: 'Portfolio:search_portfolio' }] } } } });
  const { result } = await response.json();
  expect(result.isError).not.toBe(true);
  expect(result.structuredContent.toolChecks[0].protocolCandidates).toEqual(['search_portfolio']);
  expect(result.content[0].text).toContain('MCP connection check');
  expect(result.content[0].text).toContain('REFRESH_TOOL_DISCOVERY');
  expect(result.structuredContent.checks.find(c => c.id === 'session').status).toBe('pass');
});
test('diagnostic HTTP input is strict and private schemas stay hidden on public checks', async ({ request }) => {
  const rejected = await request.post('/host/diagnostics?session=valid', { data: { token: 'do-not-accept-this' } });
  expect(rejected.status()).toBe(400);
  expect(await rejected.text()).not.toContain('do-not-accept-this');
  const publicReport = await request.post('/host/diagnostics?surface=public&session=valid', { data: { invocations: [{ name: 'workspace.confirm_retry' }] } });
  const report = await publicReport.json();
  expect(report.toolChecks[0].code).toBe('tool_not_available');
  expect(report.toolChecks[0].protocolCandidates).toEqual([]);
});
test('standalone CLI prints a readable report without a browser login', async () => {
  const env = { ...process.env };
  delete env.FORCE_COLOR;
  delete env.NO_COLOR;
  const { stdout, stderr } = await promisify(execFile)(process.execPath, ['scripts/check-connection.mjs',
    '--url', `http://127.0.0.1:${Number(process.env.E2E_PORT || 3187) + 2}`, '--surface', 'public', '--locale', 'zh'], { env });
  expect(stdout).toContain('MCP connection check');
  expect(stdout).toContain('公开端无需登录');
  expect(stderr).toBe('');
});

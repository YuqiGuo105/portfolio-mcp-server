import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Read-only release checks. Never print credentials or returned media/article data.
const required = name => {
  assert.ok(process.env[name], `${name} is required`);
  return process.env[name];
};
const gateway = new URL(required('MCP_GATEWAY_URL'));
const admin = new URL(required('ADMIN_SERVICE_URL'));
const endpoint = new URL(required('PUBLIC_MCP_URL'));
const token = required('MCP_GATEWAY_INTERNAL_TOKEN');
for (const url of [gateway, admin, endpoint]) {
  assert.equal(url.protocol, 'https:', 'Release checks require HTTPS');
  assert.equal(url.username + url.password, '', 'URLs must not contain credentials');
}
const names = [
  'media.list', 'media.get', 'media.get_upload_limits', 'media.start_upload',
  'media.resume_upload', 'media.complete_upload', 'media.update', 'media.check_delete',
  'media.delete', 'media.retry_processing', 'media.get_article',
  'media.attach_to_article', 'media.detach_from_article',
];
const reads = new Set(['media.list', 'media.get', 'media.get_upload_limits',
  'media.check_delete', 'media.get_article']);

async function request(base, path, options = {}, expected = 200) {
  const response = await fetch(new URL(path, base), {
    ...options, redirect: 'error', signal: AbortSignal.timeout(60_000),
  });
  assert.equal(response.status, expected, `${path}: unexpected HTTP status`);
  if (expected !== 200) { await response.body?.cancel(); return; }
  return response.json();
}
async function invoke(name, args = {}, role = 'ADMIN', expected = 200) {
  assert.ok(reads.has(name), 'This verifier only invokes read tools');
  return request(gateway, `/api/tools/${name}/invoke`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}`,
      'X-Actor': 'media-release-readonly-verification', 'X-Role': role },
    body: JSON.stringify(args),
  }, expected);
}

const client = new Client({ name: 'media-release-readonly-verification', version: '1.0.0' });
try {
  await request(admin, '/api/admin/media', {}, 401);
  await request(gateway, '/api/tools', {}, 401);
  await request(endpoint, '/mcp/admin', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  }, 401);
  console.log('PASS anonymous access denied by backend, gateway and Admin MCP');

  const catalog = await request(gateway, '/api/tools', {
    headers: { Authorization: `Bearer ${token}` },
  });
  for (const name of names) {
    const tool = catalog.find(item => item.name === name);
    assert.ok(tool, `Missing ${name}`);
    assert.equal(tool.requiredRole, 'ADMIN', `${name} must require ADMIN`);
    assert.equal(tool.mode, reads.has(name) ? 'READ' : 'WRITE');
    if (!reads.has(name)) assert.equal(tool.confirmRequired, true);
  }
  console.log('PASS all 13 media tools deployed with ADMIN and confirmation policies');

  for (const role of ['VIEWER', 'EDITOR', 'PUBLISHER']) {
    await invoke('media.list', { limit: 1 }, role, 403);
  }
  console.log('PASS lesser roles cannot invoke media tools');

  const limits = await invoke('media.get_upload_limits');
  assert.ok(limits.maxVideoBytes > 0 && Array.isArray(limits.videoTypes));
  const listed = await invoke('media.list', { kind: 'VIDEO', status: 'READY', limit: 1 });
  assert.ok(Array.isArray(listed.data) && listed.data.length > 0, 'A READY video is required for verification');
  const asset = await invoke('media.get', { id: listed.data[0].id });
  assert.equal(asset.status, 'READY');
  assert.ok(Number.isInteger(asset.metadataVersion) && asset.manifest);
  await invoke('media.check_delete', { id: asset.id });
  console.log('PASS administrator limits, list, detail and deletion preflight');

  if (process.env.MEDIA_VERIFY_PROJECT_ID) {
    const article = await invoke('media.get_article', {
      sourceType: 'PROJECT', sourceId: process.env.MEDIA_VERIFY_PROJECT_ID,
    });
    assert.match(article.contentHash, /^[a-f0-9]{64}$/);
    assert.ok(Array.isArray(article.mediaIds));
    assert.equal(article.publicationChanged, false);
    console.log('PASS article media references and concurrency hash');
  }
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  let cursor;
  do {
    const page = await client.listTools(cursor ? { cursor } : undefined);
    assert.ok(!page.tools.some(tool => /^media[._]/.test(tool.name)), 'Public media administration leak');
    cursor = page.nextCursor;
  } while (cursor);
  console.log('PASS public MCP does not expose media administration');
  console.log('Read-only verification complete. No uploads, edits, deletes or publication calls made.');
} finally {
  await client.close();
}

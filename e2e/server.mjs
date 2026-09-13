import http from 'node:http';
import { build } from 'esbuild';
import { SignJWT } from 'jose';
import { catalog, fixture } from './fixtures.mjs';

const port = Number(process.env.E2E_PORT || 3187);
process.env.MCP_GATEWAY_URL = `http://127.0.0.1:${port + 1}`;
process.env.MCP_GATEWAY_INTERNAL_TOKEN = 'test-workspace-gateway-key-123456789';
process.env.SUPABASE_JWT_SECRET = 'test-workspace-auth-key-123456789';
process.env.SUPABASE_AUTH_ISSUER = '';
process.env.ADMIN_SERVICE_URL = '';
process.env.ADMIN_ALLOWED_EMAILS = 'admin@example.test';
const { createHttpServer } = await import('../src/index.js');
const token = await new SignJWT({ email: 'admin@example.test' }).setProtectedHeader({ alg: 'HS256' }).setSubject('admin-fixture')
  .setAudience('authenticated').setExpirationTime('1h').sign(new TextEncoder().encode(process.env.SUPABASE_JWT_SECRET));
let mode = '', writes = 0;
const receipts = new Map();
async function body(req) { let s = ''; for await (const c of req) { s += c; if (s.length > 1e6) throw new Error('Too large'); } return s ? JSON.parse(s) : {}; }
function json(res, data, status = 200) { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); }
const backend = http.createServer(async (req, res) => {
  if (req.url === '/api/tools') return json(res, catalog);
  const name = decodeURIComponent(req.url.split('/')[3] || '');
  const args = await body(req);
  if (mode === 'partial' && name === 'operation.list') return json(res, { code: 'unavailable' }, 503);
  if (name === 'admin.retry_failed_operation') {
    const key = req.headers['idempotency-key'];
    if (!receipts.has(key)) { writes++; receipts.set(key, fixture(name, args)); }
    if (mode === 'unknown') return json(res, { code: 'unknown', safeToRetry: false, ambiguousOutcome: true }, 502);
    return json(res, receipts.get(key));
  }
  return json(res, fixture(name, args));
});
await new Promise(resolve => backend.listen(port + 1, '127.0.0.1', resolve));
const mcp = createHttpServer();
await new Promise(resolve => mcp.listen(port + 2, '127.0.0.1', resolve));
const bundle = await build({ entryPoints: ['e2e/host.js'], bundle: true, format: 'esm', write: false });
let requestId = 0;
async function rpc(method, params) {
  const result = await fetch(`http://127.0.0.1:${port + 2}/mcp/admin`, { method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++requestId, method, params }) });
  const text = await result.text();
  if (text.startsWith('event:')) return JSON.parse(text.split('\n').find(l => l.startsWith('data:')).slice(5));
  return JSON.parse(text);
}
await rpc('initialize', { protocolVersion: '2025-11-25', capabilities: {}, clientInfo: { name: 'e2e', version: '1' } });
const host = http.createServer(async (req, res) => {
  try {
    if (req.url === '/host/rpc') { const r = await body(req); return json(res, await rpc(r.method, r.params)); }
    if (req.url === '/host/control') { const data = await body(req); mode = data.mode || ''; writes = 0; receipts.clear(); return json(res, {}); }
    if (req.url === '/host/state') return json(res, { writes, keys: [...receipts.keys()] });
    if (req.url === '/host.js') { res.writeHead(200, { 'Content-Type': 'text/javascript' }); return res.end(bundle.outputFiles[0].text); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<!doctype html><html><head><meta name="viewport" content="width=device-width, initial-scale=1"><title>MCP Workspace E2E</title></head><body style="margin:0;background:#eef1f2;font:14px system-ui"><div style="max-width:900px;margin:20px auto"><div style="padding:10px">MCP Apps reference host | Fixture data <button id="theme">Dark theme</button></div><iframe id="app" title="Admin workspace" sandbox="allow-scripts" style="width:100%;height:780px;border:1px solid #dde4e4;border-radius:8px"></iframe></div><script type="module" src="/host.js"></script></body></html>');
  } catch (e) { json(res, { error: { message: e.message } }, 500); }
});
host.listen(port, '127.0.0.1', () => console.log(`Workspace E2E reference host http://127.0.0.1:${port}`));
process.on('SIGTERM', () => { host.close(); mcp.close(); backend.close(); process.exit(); });

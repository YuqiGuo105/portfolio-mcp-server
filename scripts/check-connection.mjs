import { parseArgs } from 'node:util';
import { readFile, stat } from 'node:fs/promises';

// Use the operator-selected service origin, never a URL from retrieved content.
// Tokens are opt-in, read from the environment, and never printed or written.
try {
  const { values } = parseArgs({ options: {
    url: { type: 'string' }, surface: { type: 'string', default: 'admin' }, locale: { type: 'string', default: 'en' },
    input: { type: 'string' }, authenticated: { type: 'boolean', default: false }, help: { type: 'boolean' },
  } });
  if (values.help) {
    console.log('Usage: node scripts/check-connection.mjs --url <MCP service origin> [--surface admin|public] [--locale zh|en] [--input sample.json] [--authenticated]\nAuthenticated checks read MCP_DIAGNOSTICS_TOKEN from the environment. No tokens are accepted in arguments or input files.');
  } else {
    const base = new URL(values.url);
    if (base.username || base.password || base.search || base.hash ||
        !(base.protocol === 'https:' || base.protocol === 'http:' && ['127.0.0.1', 'localhost', '[::1]'].includes(base.hostname))) throw new Error('Invalid origin');
    if (!['public', 'admin'].includes(values.surface) || !['zh', 'en'].includes(values.locale)) throw new Error('Invalid options');
    let input = {};
    if (values.input) {
      if ((await stat(values.input)).size > 16384) throw new Error('Input too large');
      input = JSON.parse(await readFile(values.input, 'utf8'));
    }
    const headers = { 'Content-Type': 'application/json' };
    if (values.authenticated) {
      if (!process.env.MCP_DIAGNOSTICS_TOKEN) throw new Error('No token configured');
      headers.Authorization = `Bearer ${process.env.MCP_DIAGNOSTICS_TOKEN}`;
    }
    const target = new URL('/mcp/diagnostics', base.origin);
    target.searchParams.set('surface', values.surface);
    const result = await fetch(target, { method: 'POST', headers, body: JSON.stringify({ ...input, locale: values.locale }),
      redirect: 'error', signal: AbortSignal.timeout(20000) });
    const report = await result.json();
    if (!['pass', 'warn', 'fail'].includes(report.status) || typeof report.markdown !== 'string') throw new Error('Invalid report');
    console.log(report.markdown);
    process.exitCode = report.status === 'fail' ? 1 : 0;
  }
} catch {
  console.error('Connection check could not complete. Verify the service origin, network, options and input size. A website proxy may not expose /mcp/diagnostics; use the MCP service origin.');
  process.exitCode = 2;
}

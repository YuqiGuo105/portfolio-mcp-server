import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

if (process.env.RUN_LIVE_PUBLIC_READ_TEST !== '1') throw new Error('Set RUN_LIVE_PUBLIC_READ_TEST=1 to run production read-only verification.');
const url = new URL(process.env.MCP_SMOKE_URL || 'https://www.yuqi.site/mcp');
const client = new Client({ name: 'public-evidence-release-verification', version: '1.0.0' });
const transport = new StreamableHTTPClientTransport(url);
async function call(name, args = {}) {
  const start = Date.now();
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, `${name} must succeed`);
  const data = JSON.parse(response.content.find(item => item.type === 'text').text);
  console.log(JSON.stringify({ tool: name, milliseconds: Date.now() - start, status: data.status ?? 'OK' }));
  return data;
}
try {
  await client.connect(transport);
  const catalog = await client.listTools();
  assert.ok(catalog.tools.some(t => t.name === 'search_knowledge'));
  assert.ok(catalog.tools.every(t => t.annotations?.readOnlyHint === true));
  assert.ok(!catalog.tools.some(t => /^(career\.|admin\.|agent\.)/.test(t.name)));
  const profile = await call('get_profile');
  assert.match(JSON.stringify(profile.profileEvidence), /Syracuse University/);
  assert.match(JSON.stringify(profile.profileEvidence), /University of Liverpool/);
  assert.ok(profile.experience.some(e => e.company === 'Goldman Sachs' && e.title !== e.company));
  assert.ok(profile.profileEvidence.every(e => e.sourceRequiresLogin && !e.url && !e.sourceId));
  assert.ok(!('education' in profile) || profile.education.length > 0);
  for (const [keyword, expected] of [['Chicago', /Chicago/i], ['Salt Lake City', /Salt Lake City/i], ['SLC', /Salt Lake|盐湖/i], ['芝加哥', /Chicago|芝加哥/i]]) {
    const result = await call('search_articles', { keyword });
    assert.equal(result.status, 'EVIDENCE_FOUND');
    assert.match(JSON.stringify(result.evidence), expected);
  }
  const answer = await call('search_knowledge', { query: 'Yuqi 的教育背景是什么？请用中文回答' });
  assert.match(JSON.stringify(answer.evidence), /Syracuse|雪城/);
  const locked = await call('get_article', { articleId: '2', sourceType: 'LIFE_BLOG' });
  assert.equal(locked.status, 'SOURCE_REQUIRES_LOGIN');
  assert.equal(locked.body, undefined);
  assert.equal(locked.url, undefined);
  const publicPost = await call('get_article', { articleId: '1' });
  assert.ok(publicPost.body.length > 0);
  const invalid = await client.callTool({ name: 'search_knowledge', arguments: { query: '' } });
  assert.equal(invalid.isError, true);
  const denied = await fetch(new URL('/mcp/admin', url), { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  assert.equal(denied.status, 401);
  console.log(`PASS ${url.origin}: MCP discovery, profile, multilingual search, old-client article read, source gating, validation, and anonymous admin denial. No content changes.`);
} finally {
  await client.close();
}

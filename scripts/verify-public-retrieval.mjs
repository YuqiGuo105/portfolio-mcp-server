import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const endpoint = new URL(process.argv[2] || 'https://www.yuqi.site/mcp');
assert.ok(endpoint.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(endpoint.hostname));
const client = new Client({ name: 'public-retrieval-verification', version: '1.0.0' });
const checks = [];
async function call(name, args = {}) {
  const started = performance.now();
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, `${name}: ${JSON.stringify(response)}`);
  const text = response.content.find(item => item.type === 'text').text;
  const result = JSON.parse(text);
  assert.ok(!result.error, `${name}: unexpected error payload`);
  checks.push({ tool: name, durationMs: Math.round(performance.now() - started), bytes: Buffer.byteLength(text) });
  return result;
}
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const { tools } = await client.listTools();
  assert.equal(tools.length, 14);
  assert.ok(!tools.some(tool => /^(admin\.|career\.|visitor\.)/.test(tool.name)));
  const overview = await call('get_overview');
  assert.equal(overview.projects.length, 3);
  assert.match(overview.reviewedAt, /^\d{4}-\d{2}-\d{2}$/);
  for (const query of ['Spring AI Alibaba LangExtract Kubernetes pull request', 'Yuqi 做过哪些开源贡献？']) {
    const result = await call('search_knowledge', { query, limit: 4 });
    assert.ok(result.evidence.some(item => item.sourceId === '0470298d-c74d-4d4b-be33-d948b033002a'));
    assert.ok(result.evidence.every(item => item.text.length <= 1000));
    assert.ok(result.evidence.every(item => !item.sourceRequiresLogin || ['PROFILE', 'OWNER_QA'].includes(item.sourceType)));
  }
  const keyword = await call('search_portfolio', { query: 'Kafka outbox', types: ['PROJECT'], limit: 3 });
  assert.ok(keyword.results.some(item => item.snippet && /Kafka|outbox/i.test(item.snippet)));
  const metadata = await call('search_portfolio', { query: 'Kafka outbox', types: ['PROJECT'], limit: 3, includeSnippets: false });
  assert.ok(metadata.results.every(item => !item.snippet));
  const articles = await call('list_articles', { sourceType: 'LIFE_BLOG' });
  assert.equal(articles.items.find(item => item.id === '1').sourceRequiresLogin, false);
  assert.equal(articles.items.find(item => item.id === '2').sourceRequiresLogin, true);
  const restricted = await call('get_article', { articleId: '2', sourceType: 'LIFE_BLOG' });
  assert.equal(restricted.status, 'SOURCE_REQUIRES_LOGIN');
  assert.ok(!restricted.body && !restricted.url);
  const travel = await call('search_knowledge', { query: 'From New York Island to California', limit: 6 });
  assert.ok(!travel.evidence.some(item => item.sourceType === 'LIFE_BLOG' && item.sourceId === '2'));
  const role = await call('match_role', { requirements: ['Kafka transactional outbox', 'LangExtract bounded retries', 'COBOL zOS mainframe assembler'] });
  assert.ok(role.matches.length >= 2);
  assert.ok(role.gaps.some(item => item.requirement.includes('COBOL')));
  assert.ok(role.matches.every(item => item.evidence.every(proof => proof.quote && proof.contentId && proof.url)));
  const admin = await fetch(new URL('/mcp/admin', endpoint), { method: 'POST' });
  assert.equal(admin.status, 401);
  console.log(JSON.stringify({ endpoint: endpoint.href, tools: tools.length, checks, status: 'PASS',
    note: 'Public read-only production checks. No publication, content mutation, or private visitor access.' }, null, 2));
} finally { await client.close(); }

import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// A small read-only smoke sample, not a load test or a cold-start guarantee.
const endpoint = new URL(process.argv[2] || 'https://www.yuqi.site/mcp');
assert.ok(endpoint.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(endpoint.hostname));
const client = new Client({ name: 'portfolio-performance-verification', version: '1.0.0' });
const observations = [];
async function call(name, args = {}) {
  const started = performance.now();
  const response = await client.callTool({ name, arguments: args });
  assert.ok(!response.isError, `${name} returned an error`);
  const text = response.content.find(block => block.type === 'text').text;
  const result = JSON.parse(text);
  assert.ok(!result.error, `${name} returned an error payload`);
  observations.push({ tool: name, durationMs: Math.round(performance.now() - started),
    textBytes: Buffer.byteLength(text), compactBytes: Buffer.byteLength(JSON.stringify(result)) });
  return result;
}
try {
  await client.connect(new StreamableHTTPClientTransport(endpoint));
  const { tools } = await client.listTools();
  assert.ok(tools.some(tool => tool.name === 'search_portfolio'));
  assert.ok(!tools.some(tool => /^(admin\.|visitor\.|career\.)/.test(tool.name)));
  const projects = await call('list_projects', { page: { size: 2, number: 0 } });
  assert.ok(projects.items.length);
  for (let round = 0; round < 3; round++) {
    const social = await call('get_social_profiles');
    assert.ok(social.total > 0);
    const search = await call('search_portfolio', { query: 'k8s', limit: 3 });
    assert.ok(search.total > 0);
    assert.ok(!search.results.some(item => 'searchText' in item || 'body' in item));
    const project = await call('get_project', { projectId: projects.items[0].id });
    assert.ok(project.body || project.sourceRequiresLogin);
    const profile = await call('get_profile');
    assert.ok(profile.experience.length && profile.profileEvidence.length);
  }
  const knowledge = await call('search_knowledge', { query: 'What is Yuqi\'s education?', limit: 2 });
  assert.ok(knowledge.total > 0);
  console.log(JSON.stringify({ endpoint: endpoint.href, observations, summary:
    [...new Set(observations.map(row => row.tool))].map(tool => {
      const rows = observations.filter(row => row.tool === tool);
      const times = rows.map(row => row.durationMs).sort((a, b) => a - b);
      return { tool, samples: rows.length, firstMs: rows[0].durationMs,
        medianMs: times[Math.floor(times.length / 2)], maxMs: times.at(-1), textBytes: rows.at(-1).textBytes };
    }), note: 'Client-observed wall time includes transport; samples are too small for production p95 or cold-start conclusions.' }, null, 2));
} finally {
  await client.close();
}

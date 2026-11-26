import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { getSiteGuide, selectSiteGuide } from '../src/site-guide.js';
import { createServer } from '../src/index.js';

const section = (key, label, covers, topics, anchor) => ({ key, label, covers, topics, url: `https://www.yuqi.site/#${anchor}` });
const data = { schemaVersion: 1, sections: [
  section('home.about', 'About', 'Who Yuqi is: his role and a short introduction.', ['about', 'introduction', '关于', '介绍'], 'tour-about'),
  section('home.background', 'My Background', 'Education and work history: degrees, universities, employers and dates.', ['education', 'degree', 'university', 'work history', '学历', '教育', '工作经历'], 'tour-background'),
  section('home.projects', 'Projects', 'Selected projects with their stack.', ['projects', 'open source', '项目'], 'tour-projects'),
  section('home.contact', 'Contact', 'How to reach Yuqi.', ['contact', 'email', '联系', '联系方式'], 'tour-contact'),
] };

test('the whole map, or the section that answers what the visitor wants to see', () => {
  const all = selectSiteGuide(data);
  assert.equal(all.status, 'FOUND'); assert.equal(all.total, 4);
  assert.deepEqual(Object.keys(all.sections[0]), ['key', 'label', 'covers', 'topics', 'url']);
  for (const [topic, key] of [['education', 'home.background'], ['Where did he study? university', 'home.background'], ['他的学历', 'home.background'],
    ['工作经历', 'home.background'], ['projects', 'home.projects'], ['open source work', 'home.projects'], ['联系方式', 'home.contact'], ['email him', 'home.contact']]) {
    assert.equal(selectSiteGuide(data, { topic }).sections[0]?.key, key, topic);
  }
  const missing = selectSiteGuide(data, { topic: 'quantum chemistry' });
  assert.equal(missing.status, 'NOT_FOUND'); assert.deepEqual(missing.sections, []); assert.match(missing.next, /without topic/);
  assert.equal(selectSiteGuide(data, { limit: 2 }).sections.length, 2);
  assert.throws(() => selectSiteGuide({ sections: [] }));
});

test('only public anchors of this site pass; nothing else in the answer is repeated', () => {
  const result = selectSiteGuide({ schemaVersion: 1, note: 'PRIVATE', sections: [
    { ...data.sections[0], secret: 'PRIVATE', topics: ['about', 7, 'x'.repeat(90)] },
    { ...data.sections[1], url: 'https://evil.example/#tour-background' },
    { ...data.sections[2], url: 'https://www.yuqi.site/admin#tour-projects' },
    { ...data.sections[3], url: 'https://www.yuqi.site/?token=PRIVATE#tour-contact' },
    { key: 'home.api', label: 'Api', covers: 'x', topics: [], url: 'https://www.yuqi.site/api/secret#x' },
    { key: 'home.script', label: 'Script', covers: 'x', topics: [], url: 'javascript:alert(1)' },
    { key: '../admin', label: 'Bad key', covers: 'x', topics: [], url: 'https://www.yuqi.site/#tour-about' },
    { key: 'home.blank', label: '', covers: 'x', topics: [], url: 'https://www.yuqi.site/#tour-about' },
    { ...data.sections[0], covers: 'A second copy of a key is dropped.' },
    { key: 'architecture.flows', label: 'Data flows', covers: 'Sequence diagrams.', topics: [], url: 'https://www.yuqi.site/architecture#flows' },
  ] });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.deepEqual(result.sections.map(item => item.key), ['home.about', 'architecture.flows']);
  assert.deepEqual(result.sections[0].topics, ['about', 'x'.repeat(40)]);
});

test('the guide is read once from the website, bounded, and kept for five minutes', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, 'https://www.yuqi.site/api/site/guide');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return { ok: true, text: async () => JSON.stringify(data) };
  };
  assert.equal((await getSiteGuide({ topic: 'education' }, fetcher)).sections[0].key, 'home.background');
  assert.equal((await getSiteGuide({}, fetcher)).total, 4);
  assert.equal(calls, 1);
});

test('public MCP lists and calls the site guide without credentials', async t => {
  const http = t.mock.method(globalThis, 'fetch', async url => {
    assert.equal(url, 'https://www.yuqi.site/api/site/guide');
    return Response.json(data);
  });
  t.mock.method(console, 'log', () => {});
  const server = createServer();
  const client = new Client({ name: 'site-guide-preview', version: '1' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  t.after(async () => { await client.close(); await server.close(); });
  const connecting = server.connect(b);
  await client.connect(a);
  await connecting;
  const tool = (await client.listTools()).tools.find(item => item.name === 'get_site_guide');
  assert.equal(tool.annotations.readOnlyHint, true);
  const response = await client.callTool({ name: tool.name, arguments: { topic: '学历' } });
  assert.ok(!response.isError);
  const result = JSON.parse(response.content[0].text);
  assert.equal(result.status, 'FOUND');
  assert.equal(result.sections[0].url, 'https://www.yuqi.site/#tour-background');
  assert.ok(http.mock.callCount() <= 1);
});

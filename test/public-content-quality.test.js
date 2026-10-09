import test from 'node:test';
import assert from 'node:assert/strict';
import { tools } from '../src/tools.js';
import { contentMarkdown, plainText, storedMermaid } from '../src/content-format.js';
import { sanitizeContentDetail, sanitizeProfile } from '../src/sanitize.js';

function mock(t, handler) {
  const previous = globalThis.fetch;
  t.after(() => { globalThis.fetch = previous; });
  globalThis.fetch = async (_url, init) => handler(JSON.parse(init.body));
}

test('stored HTML and Markdown architecture diagrams are extracted and deduplicated', () => {
  const html = '<div class="mermaid diagram">graph TD<br>A--&gt;B</div>';
  const fenced = '\n```mermaid\r\ngraph TD\nA-->B\n```';
  assert.deepEqual(storedMermaid(html + fenced), ['graph TD\nA-->B']);
  assert.deepEqual(storedMermaid('<pre><code class="language-mermaid">sequenceDiagram\nA-&gt;&gt;B: call</code></pre>'), ['sequenceDiagram\nA->>B: call']);
  assert.match(contentMarkdown(html), /```mermaid\ngraph TD\nA-->B\n```/);
});

test('HTML is readable Markdown with links, no scripts or entity noise', () => {
  const source = '<h2>Overview</h2><p>A&nbsp;B <a href="https://example.com">reference</a></p><script>secret()</script><style>hidden{}</style>';
  const body = contentMarkdown(source);
  assert.match(body, /## Overview/);
  assert.match(body, /\[reference\]\(https:\/\/example.com\)/);
  assert.doesNotMatch(body, /script|secret|hidden|&nbsp;/);
  assert.equal(plainText('<p>A&nbsp;B</p><p>C</p>'), 'A B C');
  assert.match(contentMarkdown('<table><thead><tr><th>Stage</th><th>Action</th></tr></thead><tbody><tr><td>Publish</td><td>Queue</td></tr></tbody></table>'), /\| Publish \| Queue \|/);
});

test('Markdown pagination round trips the converted body', () => {
  const item = { sourceType: 'PROJECT', content: '<p>' + 'long text '.repeat(1200) + '</p>' };
  const first = sanitizeContentDetail(item);
  const second = sanitizeContentDetail(item, { offset: first.nextOffset });
  assert.equal(first.bodyFormat, 'markdown');
  assert.equal(first.body + second.body, contentMarkdown(item.content));
  const legacy = sanitizeContentDetail({ ...item, content: '<table><tr><td>Publish</td></tr></table>' }, { format: 'html' });
  assert.equal(legacy.bodyFormat, 'html');
  assert.match(legacy.body, /^<table>/);
  const privateHtml = sanitizeContentDetail({ ...item, requireLogin: true }, { format: 'html' });
  assert.ok(!privateHtml.body, 'Compatibility format must not bypass body privacy.');
});

test('public architecture cannot reveal a restricted or draft body', async t => {
  let item = { sourceType: 'PROJECT', requireLogin: true, content: '<div class="mermaid">secret</div>' };
  mock(t, () => Response.json({ content: item }));
  const tool = tools.find(t => t.name === 'get_project_architecture');
  assert.equal((await tool.handler({ projectId: '1' })).status, 'SOURCE_REQUIRES_LOGIN');
  item = { ...item, requireLogin: false, status: 'DRAFT' };
  assert.equal((await tool.handler({ projectId: '1' })).error, 'NOT_FOUND');
});

test('content lookup errors reveal no internal tool, URL or payload', async t => {
  let status = 502;
  let message = 'Downstream returned HTTP 400';
  mock(t, () => Response.json({ message, tool: 'admin.get_content', internal: 'secret' }, { status }));
  const tool = tools.find(t => t.name === 'get_project');
  const result = await tool.handler({ projectId: 'invalid' });
  assert.equal(result.error, 'NOT_FOUND');
  assert.doesNotMatch(JSON.stringify(result), /admin\.|secret|502/);
  status = 503; message = 'private upstream address';
  await assert.rejects(tool.handler({ projectId: '1' }), /^Error: Content is temporarily unavailable/);
});

test('keyword-free lists use bounded aligned pagination and hide private records', async t => {
  mock(t, args => {
    assert.deepEqual(args, { sourceType: 'PROJECT', limit: 2, offset: 2 });
    return Response.json({ items: [
      { sourceType: 'PROJECT', sourceId: 'public', title: 'Public', summary: '<p>Readable&nbsp;summary</p>' },
      { sourceType: 'PROJECT', sourceId: 'private', title: 'Private', visibility: 'OWNER' },
    ] });
  });
  const result = await tools.find(t => t.name === 'list_projects').handler({ page: { size: 2, number: 1 } });
  assert.deepEqual(result.items.map(x => x.id), ['public']);
  assert.equal(result.items[0].summary, 'Readable summary');
  assert.equal(result.items[0].searchText, undefined);
  assert.deepEqual(result.pagination.nextPage, { size: 2, number: 2 });
});

test('profile uses actual structured dates and orders current experience first', () => {
  const profile = sanitizeProfile({ experience: [
    { title: 'Previous', summary: 'Engineer', period: 'Jan 2022 - Dec 2023' },
    { title: 'Current', summary: 'Engineer', date: 'Dec 2024 - Current' },
    { title: 'Undated', summary: 'Engineer' },
  ] });
  assert.deepEqual(profile.experience.map(x => x.company), ['Current', 'Previous', 'Undated']);
  assert.equal(profile.experience[0].period, 'Dec 2024 - Current');
  assert.equal(profile.experience[2].period, undefined);
});

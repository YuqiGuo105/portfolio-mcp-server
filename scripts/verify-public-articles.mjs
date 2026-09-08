import assert from 'node:assert/strict';

if (process.env.RUN_LIVE_PUBLIC_READ_TEST !== '1') {
  throw new Error('Set RUN_LIVE_PUBLIC_READ_TEST=1 for read-only production gateway verification.');
}
const { tools } = await import('../src/tools.js');
const search = tools.find(tool => tool.name === 'search_articles');
const read = tools.find(tool => tool.name === 'get_article');
for (const keyword of ['Chicago', 'Salt Lake City', 'SLC']) {
  const result = await search.handler({ keyword, limit: 5 });
  const article = result.articles.find(item => item.type === 'LIFE_BLOG');
  if (!article) {
    assert.equal(keyword, 'SLC');
    assert.match(JSON.stringify(result.evidence), /Salt Lake|盐湖/i);
    console.log(JSON.stringify({ keyword, semanticFallbackVerified: true }));
    continue;
  }
  if (article.sourceRequiresLogin) {
    assert.ok(result.evidenceTotal > 0);
    assert.ok(JSON.stringify(result.evidence).toLowerCase().includes(keyword.toLowerCase()));
    const detail = await read.handler({ articleId: article.id, sourceType: 'LIFE_BLOG' });
    assert.equal(detail.status, 'SOURCE_REQUIRES_LOGIN');
    assert.equal(detail.body, undefined);
    assert.equal(detail.url, undefined);
    console.log(JSON.stringify({ keyword, publicAnswerVerified: true, originalSourceProtected: true }));
    continue;
  }
  let offset = 0;
  let text = '';
  let done = false;
  for (let page = 0; page < 20; page++) {
    const detail = await read.handler({ articleId: article.id, sourceType: 'LIFE_BLOG', offset });
    text += detail.body;
    if (!detail.truncated) { done = true; break; }
    assert.ok(detail.nextOffset > offset);
    offset = detail.nextOffset;
  }
  assert.equal(done, true, 'Expected the complete article within the bounded page budget');
  assert.ok(text.toLowerCase().includes(keyword.toLowerCase()), `Expected source text mentioning ${keyword}`);
  console.log(JSON.stringify({ keyword, article: article.url, fullTextVerified: true, characters: text.length }));
}
console.log('PASS local MCP handlers -> production gateway -> public travel evidence and original-source access control. No content changes.');

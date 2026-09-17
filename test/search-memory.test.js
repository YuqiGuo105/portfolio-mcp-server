import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

test('full-text catalog refresh stays within a small production heap', () => {
  const script = `
    import assert from 'node:assert/strict';
    import { createSearchEngine } from './src/search/engine.js';
    import { searchDocument } from './src/search/catalog.js';
    const docs = Array.from({ length: 16 }, (_, i) => searchDocument({
      sourceType: 'LIFE_BLOG', sourceId: String(i), title: 'Travel journal ' + i,
      search: { schemaVersion: 1, requiresLogin: true, truncated: false,
        text: ('Travel notes about cities and engineering. 旅行日记城市与技术。'.repeat(1000)).slice(0, 39970) + ' tailuniqueword' }
    }));
    let engine;
    for (let refresh = 0; refresh < 2; refresh++) {
      engine = createSearchEngine(docs);
      const result = engine.search('tailuniqueword');
      assert.equal(result.total, 16);
      assert.equal(result.coverage.fullText, 16);
      assert.ok(result.results.every(doc => doc.sourceRequiresLogin));
      assert.ok(!JSON.stringify(result).includes('searchText'));
    }
  `;
  const child = spawnSync(process.execPath, ['--max-old-space-size=64', '--input-type=module', '-e', script], {
    cwd: new URL('..', import.meta.url), timeout: 60000, encoding: 'utf8',
    env: { ...process.env, NODE_OPTIONS: '' }, maxBuffer: 1024 * 1024,
  });
  assert.equal(child.error, undefined, String(child.error));
  assert.equal(child.status, 0, child.stderr);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { getArchitectureEvolution, selectEvolution } from '../src/architecture-evolution.js';

const data = { schemaVersion: 1, milestones: [{ id: 'outbox', type: 'decision' }, { id: 'cpu-throttle', type: 'incident' }] };
test('architecture history filters and explains missing IDs', () => {
  assert.equal(selectEvolution(data, { type: 'incident' }).milestones[0].id, 'cpu-throttle');
  assert.equal(selectEvolution(data, { milestoneId: 'missing' }).status, 'NOT_FOUND');
  assert.equal(selectEvolution(data, { limit: 1 }).milestones.length, 1);
  assert.throws(() => selectEvolution({ milestones: [] }));
});
test('history uses a positive public schema and rejects unsafe evidence links', () => {
  const result = selectEvolution({ schemaVersion: 1, note: 'PRIVATE', milestones: [{
    id: 'outbox', type: 'decision', privateLog: 'PRIVATE',
    sections: [{ label: 'Decision', text: 'Public description', secret: 'PRIVATE' }],
    evidence: [{ url: 'https://github.com/example/repo/commit/abcdef1234', title: 'Fix' },
      { url: 'https://www.yuqi.site/admin?token=PRIVATE' }],
  }] });
  assert.ok(!JSON.stringify(result).includes('PRIVATE'));
  assert.equal(result.milestones[0].evidence.length, 1);
});
test('public history fetch is bounded, cached and does not call a model or admin API', async () => {
  let calls = 0;
  const fetcher = async (url, options) => {
    calls++; assert.equal(url, 'https://www.yuqi.site/api/architecture/evolution');
    assert.equal(options.redirect, 'error'); assert.ok(options.signal);
    return { ok: true, text: async () => JSON.stringify(data) };
  };
  assert.equal((await getArchitectureEvolution({ type: 'incident' }, fetcher)).total, 1);
  await getArchitectureEvolution({}, fetcher);
  assert.equal(calls, 1);
});

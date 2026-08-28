import test from 'node:test';
import assert from 'node:assert/strict';

import { sanitizeContentDetail, sanitizeContentItem } from '../src/sanitize.js';

test('sanitizes wrapped admin content responses', () => {
  const response = {
    content: {
      sourceId: 'article-uuid',
      sourceType: 'BLOG',
      title: 'A production article',
      summary: 'Summary',
      content: 'Full body',
      raw: { internal: true },
    },
    latestVersion: { version: 4 },
    recentAuditLogs: [{ actor: 'admin' }],
  };

  assert.deepEqual(sanitizeContentItem(response), {
    id: 'article-uuid',
    type: 'BLOG',
    title: 'A production article',
    summary: 'Summary',
    category: undefined,
    tags: [],
    status: undefined,
    createdAt: undefined,
    updatedAt: undefined,
    url: 'https://www.yuqi.site/blog-single/article-uuid',
  });
  assert.equal(sanitizeContentDetail(response).body, 'Full body');
  assert.equal('recentAuditLogs' in sanitizeContentDetail(response), false);
});

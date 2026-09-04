import test from 'node:test';
import assert from 'node:assert/strict';

import { buildPortfolioSearchResult } from '../src/tools.js';

test('unified portfolio search ranks matches and groups every public content type', () => {
  const result = buildPortfolioSearchResult('Java', [
    { id: 'experience-1', type: 'EXPERIENCE', title: 'Software Engineer', summary: 'Java services' },
    { id: 'article-1', type: 'BLOG', title: 'Reliable APIs', summary: 'Examples in Java' },
    { id: 'life-1', type: 'LIFE', title: 'Conference notes', summary: 'Java community' },
    { id: 'project-1', type: 'PROJECT', title: 'Java Platform', tags: ['Java'] },
  ], 4);

  assert.equal(result.total, 4);
  assert.equal(result.results[0].id, 'project-1');
  assert.deepEqual(result.groups.projects.map(item => item.id), ['project-1']);
  assert.deepEqual(result.groups.articles.map(item => item.id), ['article-1']);
  assert.deepEqual(result.groups.life.map(item => item.id), ['life-1']);
  assert.deepEqual(result.groups.experience.map(item => item.id), ['experience-1']);
});

test('unified portfolio search enforces the public result limit', () => {
  const items = Array.from({ length: 25 }, (_, index) => ({
    id: String(index),
    type: 'PROJECT',
    title: `Project ${index}`,
    summary: 'distributed systems',
  }));

  const result = buildPortfolioSearchResult('distributed', items, 50);

  assert.equal(result.total, 20);
  assert.equal(result.groups.projects.length, 20);
});

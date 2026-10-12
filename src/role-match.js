import { searchContent } from './search/service.js';
import { readEvidenceSource, excerpt } from './public-evidence.js';

export async function matchRole(requirements) {
  const searches = await Promise.all(requirements.map(query => searchContent({ query, types: ['PROJECT', 'EXPERIENCE'], limit: 3 })));
  // Fair, round-robin selection caps one request at eight fresh source reads.
  const candidates = new Map();
  for (let rank = 0; rank < 3; rank++) for (const result of searches) {
    const item = result.results[rank];
    if (item && !item.sourceRequiresLogin && candidates.size < 8) candidates.set(`${item.type}:${item.id}`, item);
  }
  const live = new Map();
  const queue = [...candidates];
  await Promise.all(Array.from({ length: Math.min(3, queue.length) }, async () => {
    while (queue.length) {
      const [key, item] = queue.shift();
      try { live.set(key, await readEvidenceSource(item)); }
      catch { live.set(key, undefined); }
    }
  }));
  const matches = [], gaps = [];
  for (const [index, requirement] of requirements.entries()) {
    const evidence = searches[index].results.flatMap(item => {
      const source = live.get(`${item.type}:${item.id}`);
      if (!source?.text || source.sourceRequiresLogin) return [];
      const passage = excerpt(requirement, source.text, 550);
      if (!passage.matchedTerms.length) return [];
      return [{ contentId: item.id, sourceType: item.type, title: source.title,
        quote: passage.text, matchedTerms: passage.matchedTerms, url: source.url }];
    }).slice(0, 2);
    if (evidence.length) matches.push({ requirement, status: 'RELATED_PUBLIC_EVIDENCE', evidence });
    else gaps.push({ requirement, reason: searches[index].results.some(item => !live.get(`${item.type}:${item.id}`))
      ? 'EVIDENCE_UNAVAILABLE_OR_BUDGET_LIMITED' : 'NO_PUBLIC_EVIDENCE' });
  }
  return { matches, gaps, coverage: { requirements: requirements.length, verifiedSources: [...live.values()].filter(Boolean).length,
    sourceReadBudget: 8 }, guidance: 'Related excerpts are not proof that an entire requirement is satisfied. Check years, scope, and production experience in the quotes. Gaps mean no verified evidence in this bounded search, not lack of ability. No hiring score or decision is generated.' };
}

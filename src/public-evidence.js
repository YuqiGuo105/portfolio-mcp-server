import { invokeGatewayTool } from './gateway-client.js';
import { sanitizeContentItem } from './sanitize.js';
import { plainText } from './content-format.js';
import { tokens } from './search/engine.js';

export const publicRead = (name, args) => invokeGatewayTool(name, args, undefined, { timeoutMs: 8000 });

export function excerpt(query, value, max = 650) {
  const text = plainText(value, 80000) ?? '';
  const terms = [...new Set(tokens(query))];
  const lower = text.toLowerCase();
  const starts = [0, ...terms.flatMap(term => {
    const positions = [];
    for (let i = lower.indexOf(term); i !== -1 && positions.length < 30; i = lower.indexOf(term, i + term.length)) positions.push(Math.max(0, i - 100));
    return positions;
  })];
  const best = starts.map(start => ({ start, score: terms.filter(term => lower.slice(start, start + max).includes(term)).length }))
    .sort((a, b) => b.score - a.score || a.start - b.start)[0];
  return { text: text.slice(best.start, best.start + max), matchedTerms: terms.filter(term => lower.slice(best.start, best.start + max).includes(term)) };
}

export async function readEvidenceSource(item) {
  const result = await publicRead('admin.get_content', { sourceType: item.type, sourceId: item.id });
  const raw = result?.content && typeof result.content === 'object' ? result.content : result;
  if (!raw || result?.error) return null;
  const safe = sanitizeContentItem(raw);
  const status = String(raw.status ?? raw.raw?.status ?? raw.raw?.publication_status ?? '').toUpperCase();
  const visibility = String(raw.visibility ?? raw.raw?.visibility ?? '').toUpperCase();
  if ((status && !['PUBLISHED', 'ACTIVE'].includes(status)) || ['PRIVATE', 'ADMIN', 'OWNER'].includes(visibility)) return null;
  if (safe.id == null || !safe.type) throw new Error('Malformed content response');
  if (String(safe.id) !== String(item.id) || safe.type !== item.type) return null;
  return { ...safe, text: safe.sourceRequiresLogin ? '' : plainText(raw.body ?? raw.content ?? raw.summary ?? '', 80000) };
}

export async function addSnippets(query, items, limit = 3) {
  const selected = items.filter(item => !item.sourceRequiresLogin).slice(0, limit);
  const verified = new Map(await Promise.all(selected.map(async item => {
    try { return [`${item.type}:${item.id}`, await readEvidenceSource(item)]; }
    catch { return [`${item.type}:${item.id}`, undefined]; }
  })));
  return items.flatMap(item => {
    const key = `${item.type}:${item.id}`;
    if (!verified.has(key)) return [{ ...item, snippetStatus: item.sourceRequiresLogin ? 'REQUIRES_LOGIN' : 'NOT_REQUESTED' }];
    const live = verified.get(key);
    if (live === null) return [];
    if (live === undefined) return [{ ...item, snippetStatus: 'UNAVAILABLE' }];
    if (live.sourceRequiresLogin) return [{ ...item, summary: live.summary, sourceRequiresLogin: true, snippetStatus: 'REQUIRES_LOGIN' }];
    const snippet = excerpt(query, live.text);
    return [{ ...item, title: live.title, summary: live.summary, sourceRequiresLogin: false,
      ...(snippet.text ? { snippet: snippet.text } : {}), snippetStatus: snippet.text ? 'AVAILABLE' : 'EMPTY' }];
  });
}

export function safeKnowledge(result) {
  // During rolling upgrades, reject unverified document evidence from old servers.
  return (result?.evidence ?? []).flatMap(item => {
    const approved = ['PROFILE', 'OWNER_QA'].includes(item.sourceType) && item.review === 'approved';
    const document = ['PROJECT', 'BLOG', 'LIFE_BLOG', 'EXPERIENCE'].includes(item.sourceType)
      && item.accessVerified === true && item.sourceRequiresLogin === false && item.sourceId != null;
    if (!approved && !document) return [];
    return [{ text: plainText(item.text, 1000) ?? '', sourceType: item.sourceType,
      ...(approved ? { review: 'approved', sourceRequiresLogin: true } : {
        sourceId: String(item.sourceId), title: plainText(item.title, 200), sourceRequiresLogin: false,
        url: item.url,
      }) }];
  });
}

export function snippetEvidence(items) {
  return items.filter(item => item.snippet && !item.sourceRequiresLogin).map(item => ({
    text: item.snippet, sourceId: item.id, sourceType: item.type, title: item.title,
    url: item.url, sourceRequiresLogin: false, retrieval: 'lexical_live_source',
  }));
}

export function mergeEvidence(lexical, semantic, limit) {
  const seen = new Set();
  return [...lexical, ...semantic].filter(item => {
    const key = item.sourceId ? `${item.sourceType}:${item.sourceId}` : `${item.sourceType}:${item.text}`;
    if (seen.has(key)) return false;
    seen.add(key); return true;
  }).slice(0, limit);
}

// The public map of yuqi.site: its sections, what each one shows and a direct link to it.
// Read from the website's own endpoint, which serves the list the site itself navigates by.
const ENDPOINT = 'https://www.yuqi.site/api/site/guide';
const ORIGIN = 'https://www.yuqi.site';
let cached;
let inflight;
const text = (value, max) => typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : '';

// Positive schema: a section is a known shape with a link to a public anchor of this site, or it is dropped.
function publicSection(item) {
  if (!item || typeof item.key !== 'string' || !/^[a-z][a-zA-Z]{0,31}\.[a-zA-Z]{1,40}$/.test(item.key)) return [];
  let url;
  try { url = new URL(item.url); } catch { return []; }
  if (url.origin !== ORIGIN || url.search || url.username || url.password
    || !/^\/(?:[a-z0-9-]+(?:\/[a-z0-9-]+)*)?$/.test(url.pathname) || /^\/(?:admin|api)(?:\/|$)/.test(url.pathname)
    || !/^#[a-z][a-z0-9-]{0,63}$/.test(url.hash)) return [];
  const label = text(item.label, 80);
  const covers = text(item.covers, 240);
  if (!label || !covers) return [];
  const topics = (Array.isArray(item.topics) ? item.topics : []).slice(0, 24).map(topic => text(topic, 40)).filter(Boolean);
  return [{ key: item.key, label, covers, topics, url: url.href }];
}

// How well a section answers what the visitor wants to see. Works for space-separated and for
// unsegmented (Chinese) wording: a topic counts when it appears in the request or the request in it.
function relevance(section, wanted) {
  const words = wanted.split(/[^\p{L}\p{N}]+/u).filter(word => word.length > 1);
  let score = 0;
  for (const topic of section.topics.map(value => value.toLowerCase())) {
    if (wanted.includes(topic) || topic.includes(wanted)) score += 4;
    else if (words.some(word => topic.split(' ').includes(word))) score += 2;
  }
  const label = section.label.toLowerCase();
  if (wanted.includes(label) || words.some(word => label.split(' ').includes(word))) score += 3;
  if (words.some(word => section.covers.toLowerCase().split(/[^\p{L}\p{N}]+/u).includes(word))) score += 1;
  return score;
}

export function selectSiteGuide(data, { topic, limit = 12 } = {}) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.sections)) throw new Error('Site guide is unavailable');
  const all = data.sections.slice(0, 40).flatMap(publicSection)
    .filter((section, index, list) => list.findIndex(other => other.key === section.key) === index);
  const wanted = text(topic, 120).toLowerCase();
  const matches = wanted
    ? all.map(section => ({ section, score: relevance(section, wanted) })).filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score).map(item => item.section)
    : all;
  const pageSize = Number.isInteger(limit) ? Math.max(1, Math.min(20, limit)) : 12;
  return { status: matches.length ? 'FOUND' : 'NOT_FOUND', source: ENDPOINT,
    total: matches.length, sections: matches.slice(0, pageSize),
    note: 'A map of where things are on yuqi.site, with direct links. It is not the content: use get_profile or search_portfolio for facts.',
    next: wanted && !matches.length ? 'Call without topic for the whole map.' : undefined };
}

export async function getSiteGuide(args, fetchImpl = fetch) {
  if (cached && Date.now() - cached.at < 300_000) return selectSiteGuide(cached.data, args);
  if (!inflight) inflight = (async () => {
    const response = await fetchImpl(ENDPOINT, { signal: AbortSignal.timeout(4000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Site guide is temporarily unavailable');
    const body = await response.text();
    if (body.length > 50_000) throw new Error('Site guide exceeded the response limit');
    const data = JSON.parse(body);
    selectSiteGuide(data);
    cached = { data, at: Date.now() };
    return data;
  })().finally(() => { inflight = null; });
  return selectSiteGuide(await inflight, args);
}

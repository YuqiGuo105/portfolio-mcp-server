const ENDPOINT = 'https://www.yuqi.site/api/architecture/evolution';
let cached;
let inflight;
const text = (value, max) => typeof value === 'string' ? value.slice(0, max) : '';

function publicMilestone(item) {
  if (!item || !/^[a-z0-9-]{1,64}$/.test(item.id) || !['milestone', 'decision', 'incident'].includes(item.type)) return [];
  return [{ id: item.id, type: item.type, date: text(item.date, 32), title: text(item.title, 160), summary: text(item.summary, 2400),
    url: `https://www.yuqi.site/architecture#evolution/${item.id}`,
    sections: (Array.isArray(item.sections) ? item.sections : []).slice(0, 8)
      .filter(section => section && typeof section.text === 'string')
      .map(section => ({ label: text(section.label, 120), text: text(section.text, 4000) })),
    evidence: (Array.isArray(item.evidence) ? item.evidence : []).slice(0, 8)
      .filter(source => typeof source?.url === 'string' && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/commit\/[a-f\d]{7,40}$/i.test(source.url))
      .map(source => ({ title: text(source.title, 160), url: source.url })),
  }];
}

export function selectEvolution(data, { milestoneId, type, limit = 8 } = {}) {
  if (data?.schemaVersion !== 1 || !Array.isArray(data.milestones)) throw new Error('Architecture history is unavailable');
  const matches = data.milestones.flatMap(publicMilestone).filter(item => (!milestoneId || item.id === milestoneId) && (!type || item.type === type));
  const pageSize = Number.isInteger(limit) ? Math.max(1, Math.min(20, limit)) : 8;
  return { status: matches.length ? 'FOUND' : 'NOT_FOUND', source: ENDPOINT,
    total: matches.length, milestones: matches.slice(0, pageSize),
    note: 'Curated public history with commit evidence, not live status or private incident logs.',
    next: matches.length > pageSize ? 'Increase limit or filter by type or milestoneId.' : undefined };
}

export async function getArchitectureEvolution(args, fetchImpl = fetch) {
  if (cached && Date.now() - cached.at < 300_000) return selectEvolution(cached.data, args);
  if (!inflight) inflight = (async () => {
    const response = await fetchImpl(ENDPOINT, { signal: AbortSignal.timeout(4000), redirect: 'error', headers: { Accept: 'application/json' } });
    if (!response.ok) throw new Error('Architecture history is temporarily unavailable');
    const body = await response.text();
    if (body.length > 100_000) throw new Error('Architecture history exceeded the response limit');
    const data = JSON.parse(body);
    selectEvolution(data);
    cached = { data, at: Date.now() };
    return data;
  })().finally(() => { inflight = null; });
  return selectEvolution(await inflight, args);
}

/**
 * Sanitize gateway responses before returning to MCP clients.
 * Strips internal fields, enforces max length, and adds canonical URLs.
 */

const SITE_URL = process.env.SITE_URL || 'https://www.yuqi.site';
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH) || 8000;

export function sanitizeContentItem(item) {
  item = unwrapContent(item);
  if (!item) return null;
  const type = String(item.sourceType ?? item.type ?? '').toUpperCase();
  const requiresLogin = item.requireLogin ?? item.require_login ?? item.raw?.require_login
    ?? (type === 'LIFE' || type === 'LIFE_BLOG');
  const safe = {
    id: item.sourceId ?? item.id,
    type: item.sourceType ?? item.type,
    title: item.title,
    summary: item.summary ?? item.description,
    category: item.category,
    tags: Array.isArray(item.tags) ? item.tags : [],
    status: item.status,
    createdAt: item.createdAt,
    updatedAt: item.updatedAt,
    url: requiresLogin ? undefined : buildCanonicalUrl(item),
    ...(requiresLogin ? { sourceRequiresLogin: true } : {}),
  };
  // Never expose: internalId, version, indexStatus, auditLog, rawHtml
  return safe;
}

export function sanitizeContentDetail(item, { offset = 0 } = {}) {
  item = unwrapContent(item);
  if (!item) return null;
  const base = sanitizeContentItem(item);
  if (base.sourceRequiresLogin) {
    return { ...base, status: 'SOURCE_REQUIRES_LOGIN',
      guidance: 'The original article requires sign-in. Use search_knowledge with the user question for public-answer evidence; do not disclose a restricted source link or infer that the article has no relevant information.' };
  }
  const content = item.body ?? item.content ?? '';
  const start = Math.min(Math.max(0, offset), content.length);
  const end = Math.min(start + MAX_CONTENT_LENGTH, content.length);
  const truncated = end < content.length;
  return { ...base, body: content.slice(start, end), offset: start, totalLength: content.length,
    truncated, ...(truncated ? { nextOffset: end } : {}) };
}

function unwrapContent(item) {
  if (!item || typeof item !== 'object') return item;
  return item.content && typeof item.content === 'object' ? item.content : item;
}

export function sanitizeProfile(data) {
  if (!data) return null;
  // Only return public-safe profile fields
  return {
    name: data.name ?? data.title,
    headline: data.headline ?? data.summary,
    ...(Array.isArray(data.skills) ? { skills: data.skills } : {}),
    experience: Array.isArray(data.experience) ? data.experience.map(e => ({
      company: e.company ?? e.title,
      title: e.role ?? e.summary ?? e.title,
      period: e.period ?? e.duration ?? e.raw?.date,
      description: (e.description ?? e.content)?.slice(0, 2000),
    })) : [],
    ...(Array.isArray(data.education) ? { education: data.education } : {}),
    url: `${SITE_URL}/cv`,
  };
}

function buildCanonicalUrl(item) {
  const type = (item.sourceType ?? item.type ?? '').toUpperCase();
  const id = item.sourceId ?? item.id;
  switch (type) {
    case 'BLOG': return `${SITE_URL}/blog-single/${id}`;
    case 'LIFE': case 'LIFE_BLOG': return `${SITE_URL}/life-blog/${id}`;
    case 'PROJECT': return `${SITE_URL}/work-single/${id}`;
    default: return `${SITE_URL}`;
  }
}

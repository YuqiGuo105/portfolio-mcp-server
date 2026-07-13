/**
 * Sanitize gateway responses before returning to MCP clients.
 * Strips internal fields, enforces max length, and adds canonical URLs.
 */

const SITE_URL = process.env.SITE_URL || 'https://www.yuqi.site';
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH) || 8000;

export function sanitizeContentItem(item) {
  if (!item) return null;
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
    url: buildCanonicalUrl(item),
  };
  // Never expose: internalId, version, indexStatus, auditLog, rawHtml
  return safe;
}

export function sanitizeContentDetail(item) {
  if (!item) return null;
  const base = sanitizeContentItem(item);
  let body = item.body ?? item.content ?? '';
  if (body.length > MAX_CONTENT_LENGTH) {
    body = body.slice(0, MAX_CONTENT_LENGTH) + '\n\n[Content truncated. Full article at ' + base.url + ']';
  }
  return { ...base, body };
}

export function sanitizeProfile(data) {
  if (!data) return null;
  // Only return public-safe profile fields
  return {
    name: data.name ?? data.title,
    headline: data.headline ?? data.summary,
    skills: Array.isArray(data.skills) ? data.skills : [],
    experience: Array.isArray(data.experience) ? data.experience.map(e => ({
      company: e.company,
      title: e.title ?? e.role,
      period: e.period ?? e.duration,
      description: e.description?.slice(0, 500),
    })) : [],
    education: Array.isArray(data.education) ? data.education : [],
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

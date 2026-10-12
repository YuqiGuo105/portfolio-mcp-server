/**
 * Sanitize gateway responses before returning to MCP clients.
 * Strips internal fields, enforces max length, and adds canonical URLs.
 */

import { contentMarkdown, plainText } from './content-format.js';

const SITE_URL = process.env.SITE_URL || 'https://www.yuqi.site';
const MAX_CONTENT_LENGTH = Number(process.env.MAX_CONTENT_LENGTH) || 8000;

export function contentRequiresLogin(item) {
  const type = String(item.sourceType ?? item.type ?? '').toUpperCase();
  const flag = item.requireLogin ?? item.require_login ?? item.raw?.require_login ?? item.search?.requiresLogin;
  return flag === undefined ? ['LIFE', 'LIFE_BLOG'].includes(type) : flag !== false;
}

export function sanitizeContentItem(item) {
  item = unwrapContent(item);
  if (!item) return null;
  const type = String(item.sourceType ?? item.type ?? '').toUpperCase();
  const requiresLogin = contentRequiresLogin(item);
  const safe = {
    id: item.sourceId ?? item.id,
    type: item.sourceType ?? item.type,
    title: item.title,
    summary: plainText(item.summary ?? item.description),
    category: item.category == null ? undefined : plainText(item.category, 200).split(',').map(s => s.trim()).filter(Boolean).join(', '),
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

export function sanitizeContentDetail(item, { offset = 0, format = 'markdown' } = {}) {
  item = unwrapContent(item);
  if (!item) return null;
  const base = sanitizeContentItem(item);
  if (base.sourceRequiresLogin) {
    return { ...base, status: 'SOURCE_REQUIRES_LOGIN',
      guidance: 'The original article requires sign-in. Use search_knowledge with the user question for public-answer evidence; do not disclose a restricted source link or infer that the article has no relevant information.' };
  }
  const raw = String(item.body ?? item.content ?? '');
  const content = format === 'html' ? raw : contentMarkdown(raw);
  const start = Math.min(Math.max(0, offset), content.length);
  const end = Math.min(start + MAX_CONTENT_LENGTH, content.length);
  const truncated = end < content.length;
  return { ...base, body: content.slice(start, end), bodyFormat: format, offset: start, totalLength: content.length,
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
      company: plainText(e.company ?? e.title, 200),
      title: plainText(e.role ?? e.summary ?? e.title, 300),
      period: plainText(e.period ?? e.duration ?? e.date ?? e.raw?.date, 150),
      description: plainText(e.description ?? e.content),
    })).sort((a, b) => experienceOrder(b.period) - experienceOrder(a.period)) : [],
    ...(Array.isArray(data.education) ? { education: data.education } : {}),
    url: `${SITE_URL}/cv`,
  };
}

function experienceOrder(period = '') {
  if (/\b(current|present|now)\b/i.test(period)) return 9999;
  const years = period.match(/\b(?:19|20)\d{2}\b/g);
  return years ? Number(years.at(-1)) : 0;
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

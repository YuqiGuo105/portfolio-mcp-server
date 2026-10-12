/**
 * Public MCP tool definitions.
 * All tools are read-only, no-auth, non-destructive.
 * They call the existing MCP Gateway internally.
 */

import { invokeGatewayTool, GatewayError } from './gateway-client.js';
import { publicSocialProfiles } from './public-profiles.js';
import { sanitizeContentItem, sanitizeContentDetail, sanitizeProfile } from './sanitize.js';
import { z } from 'zod';
import { searchContent } from './search/service.js';
import { storedMermaid, plainText } from './content-format.js';
import { searchDocument } from './search/catalog.js';

// Public reads fail within a short budget; write/career deadlines are unchanged.
const invokePublicRead = (name, args) => invokeGatewayTool(name, args, undefined, { timeoutMs: 8000 });

const contentIdSchema = z.union([z.string(), z.number()])
  .transform(String)
  .describe('Content UUID or legacy numeric ID');

/** Shared MCP tool annotations for all public tools. */
const PUBLIC_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export const tools = [
  {
    name: 'search_portfolio',
    description: 'Search public projects, technical articles, LIFE_BLOG travel/personal posts, and professional experience. For travel, cities or interviews search life posts too, then read matching articles with get_article using their sourceType. An empty keyword result is not evidence that something never happened.',
    zodSchema: {
      query: z.string().trim().min(1).max(300).describe('Search query, technology, architecture pattern, topic, company, or experience keyword'),
      types: z.array(z.enum(['PROJECT', 'BLOG', 'LIFE_BLOG', 'EXPERIENCE'])).min(1).max(4).optional()
        .describe('Optional content types to include; defaults to all public portfolio content'),
      limit: z.number().min(1).max(20).optional().describe('Maximum total results (1-20, default 12)'),
      diagnostics: z.boolean().optional().describe('Include ranking and index diagnostics; off by default'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const limit = Math.max(1, Math.min(args.limit ?? 12, 20));
      const result = await searchContent({ ...args, limit });
      let knowledge = null;
      let evidenceStatus = 'NOT_REQUESTED';
      if (result.total === 0 || result.results.some(item => item.sourceRequiresLogin)) {
        try {
          knowledge = await invokePublicRead('portfolio.search_public_knowledge',
            { query: args.query, limit: Math.min(limit, 6) });
          evidenceStatus = 'AVAILABLE';
        } catch (error) {
          if (!result.total) throw error;
          // A knowledge outage must not erase independently verified article matches.
          evidenceStatus = 'UNAVAILABLE';
        }
      }
      return { ...compactSearch(result, args.diagnostics),
        evidence: knowledge?.evidence ?? [], evidenceTotal: knowledge?.total ?? 0, evidenceStatus,
        status: result.total || knowledge?.total ? 'EVIDENCE_FOUND' : 'NO_EVIDENCE',
        searchedTypes: args.types ?? ['PROJECT', 'BLOG', 'LIFE_BLOG', 'EXPERIENCE'],
        guidance: 'Read matching records and evidence before making factual claims. A keyword miss is not proof of absence. Restricted original articles require sign-in; search result links do not bypass access checks.'
          + (evidenceStatus === 'UNAVAILABLE' ? ' Knowledge evidence is temporarily unavailable; these are article previews only, not verified answers to personal questions.' : '') };
    },
  },

  ...['PROJECT', 'BLOG'].map(sourceType => ({
    name: sourceType === 'PROJECT' ? 'list_projects' : 'list_articles',
    description: sourceType === 'PROJECT'
      ? 'List published project previews without a keyword. Follow pagination.nextPage to continue.'
      : 'List article previews without a keyword. Select BLOG (default) or LIFE_BLOG; restricted originals still require sign-in.',
    zodSchema: {
      ...(sourceType === 'BLOG' ? { sourceType: z.enum(['BLOG', 'LIFE_BLOG']).optional() } : {}),
      page: z.object({ size: z.number().int().min(1).max(50).default(20), number: z.number().int().min(0).max(1000).default(0) }).optional(),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async args => {
      const size = args.page?.size ?? 20;
      const number = args.page?.number ?? 0;
      const result = await invokePublicRead('admin.search_content', {
        sourceType: args.sourceType ?? sourceType, limit: size, offset: number * size,
      });
      if (!Array.isArray(result?.items)) throw new Error('Content listing is temporarily unavailable.');
      const items = result.items.map(searchDocument).filter(Boolean).map(({ searchText, textCoverage, key, ...item }) => item);
      const hasMore = result.items.length === size;
      return { items, pagination: { size, number, hasMore, ...(hasMore ? { nextPage: { size, number: number + 1 } } : {}) } };
    },
  })),

  {
    name: 'search_projects',
    description: 'Search Yuqi\'s portfolio projects by technology, architecture pattern, or keyword. Returns matching projects with titles, tech stacks, and URLs.',
    zodSchema: {
      keyword: z.string().describe('Search keyword (technology, pattern, or topic)'),
      category: z.string().optional().describe('Optional category filter'),
      limit: z.number().min(1).max(20).optional().describe('Max results (1-20, default 10)'),
      diagnostics: z.boolean().optional(),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await searchContent({
        query: args.keyword,
        types: ['PROJECT'],
        category: args.category,
        limit: Math.min(args.limit ?? 10, 20),
      });
      const { results, ...metadata } = compactSearch(result, args.diagnostics);
      return { projects: results, ...metadata };
    },
  },

  {
    name: 'get_project',
    description: 'Get detailed information about a specific portfolio project including problem statement, implementation details, technical decisions, and links.',
    zodSchema: {
      projectId: contentIdSchema,
      offset: z.number().int().min(0).max(2000000).optional().describe('Use nextOffset to read the next Markdown page'),
      format: z.enum(['markdown', 'html']).optional().describe('Markdown by default; HTML only for clients parsing stored tables'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await readPublicContent({
        sourceType: 'PROJECT',
        sourceId: args.projectId,
      });
      return result?.error ? result : sanitizeContentDetail(result, { offset: args.offset ?? 0, format: args.format ?? 'markdown' }) ?? notFound();
    },
  },

  {
    name: 'get_project_architecture',
    description: 'Get the stored architecture diagram and component descriptions for a project. Returns pre-authored Mermaid diagrams and structured component definitions — never generates them.',
    zodSchema: {
      projectId: contentIdSchema,
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await readPublicContent({
        sourceType: 'PROJECT',
        sourceId: args.projectId,
      });
      if (result?.error) return result;
      const content = result?.content && typeof result.content === 'object' ? result.content : result;
      if (!content) return notFound();
      if (sanitizeContentItem(content)?.sourceRequiresLogin) return sanitizeContentDetail(content);
      // Extract architecture sections from the project body
      const body = content.body ?? content.content ?? '';
      const mermaidBlocks = storedMermaid(body);
      return {
        projectId: args.projectId,
        title: content.title,
        diagrams: mermaidBlocks,
        hasDiagrams: mermaidBlocks.length > 0,
        url: sanitizeContentItem(content)?.url,
        note: mermaidBlocks.length === 0
          ? 'This project does not have stored architecture diagrams.'
          : undefined,
      };
    },
  },

  {
    name: 'search_articles',
    description: 'Search BOTH published technical articles and life/travel posts. Use this for cities, travel and interviews as well as technical topics. Read results with get_article(articleId, sourceType); retain the returned BLOG or LIFE_BLOG type. No match does not establish that an event never happened.',
    zodSchema: {
      keyword: z.string().trim().min(1).max(300).describe('Search keyword or topic'),
      category: z.string().optional().describe('Optional category filter'),
      sourceType: z.enum(['BLOG', 'LIFE_BLOG']).optional().describe('Optional article collection; omitted searches both technical and life/travel posts'),
      limit: z.number().min(1).max(20).optional().describe('Max results (1-20, default 10)'),
      diagnostics: z.boolean().optional(),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await tools.find(tool => tool.name === 'search_portfolio').handler({
        query: args.keyword, types: args.sourceType ? [args.sourceType] : ['BLOG', 'LIFE_BLOG'],
        category: args.category, limit: Math.min(args.limit ?? 10, 20), diagnostics: args.diagnostics,
      });
      return { articles: result.results, total: result.total, evidence: result.evidence,
        evidenceTotal: result.evidenceTotal, evidenceStatus: result.evidenceStatus, status: result.status, searchedTypes: result.searchedTypes,
        searchMode: result.searchMode, guidance: result.guidance, requestId: result.requestId,
        modelVersion: result.modelVersion, indexVersion: result.indexVersion, coverage: result.coverage };
    },
  },

  {
    name: 'get_article',
    description: 'Read a technical or life/travel article. Pass sourceType from search results (BLOG or LIFE_BLOG), especially for numeric life-post IDs. Supports bounded pagination: when truncated, call again with nextOffset to inspect the rest before concluding that a fact is absent.',
    zodSchema: {
      articleId: contentIdSchema,
      sourceType: z.enum(['BLOG', 'LIFE_BLOG']).optional().describe('Collection from the search result; if omitted, legacy numeric IDs resolve to LIFE_BLOG and other IDs to BLOG'),
      offset: z.number().int().min(0).max(2000000).optional().describe('Character offset from nextOffset; defaults to 0'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await readPublicContent({
        sourceType: args.sourceType ?? (/^\d+$/.test(String(args.articleId)) ? 'LIFE_BLOG' : 'BLOG'),
        sourceId: args.articleId,
      });
      return result?.error ? result : sanitizeContentDetail(result, { offset: args.offset ?? 0 }) ?? notFound();
    },
  },

  {
    name: 'search_knowledge',
    description: 'Search published portfolio articles and owner-approved PUBLIC answers/profile evidence using multilingual semantic retrieval. Use for natural-language personal background, education, travel/cities, abbreviations or questions missed by keyword search. Answer in the user\'s requested language and only from relevant passages. Private career memory and restricted source records are NOT accessible.',
    zodSchema: {
      query: z.string().trim().min(1).max(300).describe('The full user question, in any language; do not reduce it to English keywords'),
      limit: z.number().int().min(1).max(8).optional(),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async args => invokePublicRead('portfolio.search_public_knowledge', { query: args.query, limit: args.limit ?? 6 }),
  },

  {
    name: 'get_social_profiles',
    description: 'Get Yuqi Guo\'s verified public GitHub, LeetCode, and Instagram profile links. Returns only HTTPS URLs configured by the portfolio owner; use the exact returned URLs and do not guess missing profiles.',
    zodSchema: {},
    annotations: PUBLIC_ANNOTATIONS,
    handler: async () => {
      const profiles = publicSocialProfiles();
      return {
        profiles,
        total: profiles.length,
        status: profiles.length ? 'EVIDENCE_FOUND' : 'NO_EVIDENCE',
        guidance: 'These are owner-configured public profile links. Use the exact URL returned for each platform.',
      };
    },
  },

  {
    name: 'get_profile',
    description: 'Get current owner-approved public profile evidence, including education, public work experience, and verified GitHub, LeetCode, and Instagram links. Read profileEvidence for degrees and institutions; do not assume missing structured fields mean missing qualifications. Answer in the requested language. Does not access private application memory or resumes.',
    zodSchema: {},
    annotations: PUBLIC_ANNOTATIONS,
    handler: async () => {
      // Read all public experience records; job-title filtering is not a profile source.
      const responses = await Promise.allSettled([
        invokePublicRead('portfolio.get_public_profile', {}),
        invokePublicRead('admin.search_content', { sourceType: 'EXPERIENCE', limit: 50 }),
      ]);
      const failed = responses.find(response => response.status === 'rejected');
      if (failed) throw failed.reason;
      const [profile, result] = responses.map(response => response.value);
      const items = result?.items ?? result?.content ?? [];
      const socialProfiles = publicSocialProfiles();
      return { ...profile, ...sanitizeProfile({ ...profile, experience: items }),
        socialProfiles,
        status: profile.profileEvidence?.length || items.length || socialProfiles.length
          ? 'EVIDENCE_FOUND' : 'NO_EVIDENCE',
        coverage: { profile: 'owner_reviewed_public_evidence', experience: 'public_experience_records',
          socialProfiles: 'owner_configured_public_links', skills: 'not_separately_structured' } };
    },
  },
];

function compactSearch(result, diagnostics = false) {
  if (diagnostics) return result;
  return { query: result.query, total: result.total, results: result.results.map(({ rank, key, ...item }) => ({
    ...item, summary: plainText(item.summary),
  })) };
}

function notFound() {
  return { error: 'NOT_FOUND', guidance: 'Use search_portfolio or list_projects/list_articles to find a valid content ID and type.' };
}

async function readPublicContent(args) {
  try {
    const result = await invokePublicRead('admin.get_content', args);
    const item = result?.content && typeof result.content === 'object' ? result.content : result;
    const status = String(item?.status ?? item?.raw?.status ?? '').toUpperCase();
    const visibility = String(item?.visibility ?? item?.raw?.visibility ?? '').toUpperCase();
    if (!item || (status && !['PUBLISHED', 'ACTIVE'].includes(status)) || ['PRIVATE', 'ADMIN', 'OWNER'].includes(visibility)) return notFound();
    return result;
  } catch (error) {
    if (error instanceof GatewayError && ([400, 404].includes(error.details?.httpStatus)
        || /Downstream returned HTTP (400|404)\b/.test(error.message))) return notFound();
    // Do not expose service URLs, internal tool names or downstream payloads.
    throw new Error('Content is temporarily unavailable. Please try again later.');
  }
}

export function buildPortfolioSearchResult(query, items, limit = 12) {
  const ranked = [...items]
    .map(item => ({ item, score: relevanceScore(query, item) }))
    .sort((a, b) => b.score - a.score || String(a.item.title ?? '').localeCompare(String(b.item.title ?? '')))
    .slice(0, Math.max(1, Math.min(limit, 20)))
    .map(({ item }) => item);

  const groups = {
    projects: [],
    articles: [],
    life: [],
    experience: [],
  };
  for (const item of ranked) {
    switch (normalizeContentType(item.type)) {
      case 'PROJECT': groups.projects.push(item); break;
      case 'BLOG': groups.articles.push(item); break;
      case 'LIFE_BLOG': groups.life.push(item); break;
      case 'EXPERIENCE': groups.experience.push(item); break;
      default: break;
    }
  }

  return { query, results: ranked, groups, total: ranked.length };
}

function relevanceScore(query, item) {
  const needle = String(query ?? '').trim().toLowerCase();
  if (!needle) return 0;
  const title = String(item.title ?? '').toLowerCase();
  const summary = String(item.summary ?? '').toLowerCase();
  const category = String(item.category ?? '').toLowerCase();
  const tags = Array.isArray(item.tags) ? item.tags.map(tag => String(tag).toLowerCase()) : [];

  let score = 0;
  if (title === needle) score += 100;
  else if (title.startsWith(needle)) score += 60;
  else if (title.includes(needle)) score += 40;
  if (tags.includes(needle)) score += 35;
  else if (tags.some(tag => tag.includes(needle))) score += 20;
  if (category.includes(needle)) score += 15;
  if (summary.includes(needle)) score += 10;
  for (const term of searchTerms(query)) {
    if (title.includes(term)) score += 8;
    if (summary.includes(term)) score += 3;
    if (tags.some(tag => tag.includes(term))) score += 5;
  }
  return score;
}

function searchTerms(query) {
  return [...new Set(String(query).toLowerCase().match(/[\p{L}\p{N}]+/gu) || [])]
    .filter(term => term.length > 1).slice(0, 4);
}

function normalizeContentType(type) {
  const normalized = String(type ?? '').toUpperCase();
  return normalized === 'LIFE' ? 'LIFE_BLOG' : normalized;
}

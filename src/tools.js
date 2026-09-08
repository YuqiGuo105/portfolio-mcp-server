/**
 * Public MCP tool definitions.
 * All tools are read-only, no-auth, non-destructive.
 * They call the existing MCP Gateway internally.
 */

import { invokeGatewayTool } from './gateway-client.js';
import { sanitizeContentItem, sanitizeContentDetail, sanitizeProfile } from './sanitize.js';
import { z } from 'zod';

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
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const requestedTypes = args.types?.length ? [...new Set(args.types)] : [undefined];
      const limit = Math.max(1, Math.min(args.limit ?? 12, 20));
      const items = new Map();
      async function retrieve(keyword) {
        // Apply type before the upstream limit; otherwise unrelated projects can hide article matches.
        for (const sourceType of requestedTypes) {
          const result = await invokeGatewayTool('admin.search_content', { keyword, sourceType, limit,
            ...(args.category ? { category: args.category } : {}) });
          for (const raw of result?.items ?? result?.content ?? []) {
            const item = sanitizeContentItem(raw);
            if (!item || (sourceType && normalizeContentType(item.type) !== sourceType)) continue;
            items.set(`${normalizeContentType(item.type)}:${item.id}`, item);
          }
        }
      }
      await retrieve(args.query);
      const terms = searchTerms(args.query);
      const fallback = items.size === 0 && terms.length > 1;
      if (fallback) {
        // Bounded OR fallback for mixed-language keywords, without a topic-specific synonym dictionary.
        for (const term of terms) await retrieve(term);
      }
      const knowledge = items.size === 0 || [...items.values()].some(item => item.sourceRequiresLogin)
        ? await invokeGatewayTool('portfolio.search_public_knowledge', { query: args.query, limit: Math.min(limit, 6) })
        : null;
      return { ...buildPortfolioSearchResult(args.query, [...items.values()], limit),
        evidence: knowledge?.evidence ?? [], evidenceTotal: knowledge?.total ?? 0,
        status: items.size || knowledge?.total ? 'EVIDENCE_FOUND' : 'NO_EVIDENCE',
        searchMode: fallback ? 'keyword_union' : 'phrase',
        searchedTypes: args.types ?? ['PROJECT', 'BLOG', 'LIFE_BLOG', 'EXPERIENCE'],
        guidance: 'Read matching records and evidence before making factual claims. A keyword miss is not proof of absence. Evidence may come from owner-approved answers even when there are no matching articles. Restricted source records require admin login.',
        ...(fallback ? { queryTerms: terms } : {}) };
    },
  },

  {
    name: 'search_projects',
    description: 'Search Yuqi\'s portfolio projects by technology, architecture pattern, or keyword. Returns matching projects with titles, tech stacks, and URLs.',
    zodSchema: {
      keyword: z.string().describe('Search keyword (technology, pattern, or topic)'),
      category: z.string().optional().describe('Optional category filter'),
      limit: z.number().min(1).max(20).optional().describe('Max results (1-20, default 10)'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await invokeGatewayTool('admin.search_content', {
        keyword: args.keyword,
        sourceType: 'PROJECT',
        category: args.category,
        limit: Math.min(args.limit ?? 10, 20),
      });
      const items = (result?.items ?? result?.content ?? []).map(sanitizeContentItem).filter(Boolean);
      return { projects: items, total: items.length };
    },
  },

  {
    name: 'get_project',
    description: 'Get detailed information about a specific portfolio project including problem statement, implementation details, technical decisions, and links.',
    zodSchema: {
      projectId: contentIdSchema,
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await invokeGatewayTool('admin.get_content', {
        sourceType: 'PROJECT',
        sourceId: args.projectId,
      });
      return sanitizeContentDetail(result) ?? { error: 'Project not found' };
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
      const result = await invokeGatewayTool('admin.get_content', {
        sourceType: 'PROJECT',
        sourceId: args.projectId,
      });
      const content = result?.content && typeof result.content === 'object' ? result.content : result;
      if (!content) return { error: 'Project not found' };
      // Extract architecture sections from the project body
      const body = content.body ?? content.content ?? '';
      const mermaidBlocks = [];
      const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
      let match;
      while ((match = mermaidRegex.exec(body)) !== null) {
        mermaidBlocks.push(match[1].trim());
      }
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
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await tools.find(tool => tool.name === 'search_portfolio').handler({
        query: args.keyword, types: args.sourceType ? [args.sourceType] : ['BLOG', 'LIFE_BLOG'],
        category: args.category, limit: Math.min(args.limit ?? 10, 20),
      });
      return { articles: result.results, total: result.total, evidence: result.evidence,
        evidenceTotal: result.evidenceTotal, status: result.status, searchedTypes: result.searchedTypes,
        searchMode: result.searchMode, guidance: result.guidance };
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
      const result = await invokeGatewayTool('admin.get_content', {
        sourceType: args.sourceType ?? (/^\d+$/.test(String(args.articleId)) ? 'LIFE_BLOG' : 'BLOG'),
        sourceId: args.articleId,
      });
      return sanitizeContentDetail(result, { offset: args.offset ?? 0 }) ?? { error: 'Article not found' };
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
    handler: async args => invokeGatewayTool('portfolio.search_public_knowledge', { query: args.query, limit: args.limit ?? 6 }),
  },

  {
    name: 'get_profile',
    description: 'Get current owner-approved public profile evidence, including education, together with public work experience. Read profileEvidence for degrees and institutions; do not assume missing structured fields mean missing qualifications. Answer in the requested language. Does not access private application memory or resumes.',
    zodSchema: {},
    annotations: PUBLIC_ANNOTATIONS,
    handler: async () => {
      const profile = await invokeGatewayTool('portfolio.get_public_profile', {});
      // Read all public experience records; job-title filtering is not a profile source.
      const result = await invokeGatewayTool('admin.search_content', {
        sourceType: 'EXPERIENCE',
        limit: 50,
      });
      const items = result?.items ?? result?.content ?? [];
      return { ...sanitizeProfile({ experience: items }), ...profile,
        status: profile.profileEvidence?.length || items.length ? 'EVIDENCE_FOUND' : 'NO_EVIDENCE',
        coverage: { profile: 'owner_reviewed_public_evidence', experience: 'public_experience_records',
          skills: 'not_separately_structured' } };
    },
  },
];

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

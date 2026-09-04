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
    description: 'Search across Yuqi\'s public portfolio, including projects, technical articles, life posts, and professional experience. Returns ranked results and groups them by content type.',
    zodSchema: {
      query: z.string().min(1).describe('Search query, technology, architecture pattern, topic, company, or experience keyword'),
      types: z.array(z.enum(['PROJECT', 'BLOG', 'LIFE_BLOG', 'EXPERIENCE'])).min(1).max(4).optional()
        .describe('Optional content types to include; defaults to all public portfolio content'),
      limit: z.number().min(1).max(20).optional().describe('Maximum total results (1-20, default 12)'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const requestedTypes = args.types?.length ? new Set(args.types) : null;
      const result = await invokeGatewayTool('admin.search_content', {
        keyword: args.query,
        limit: Math.min(args.limit ?? 12, 20),
      });
      const items = (result?.items ?? result?.content ?? [])
        .map(sanitizeContentItem)
        .filter(Boolean)
        .filter(item => !requestedTypes || requestedTypes.has(normalizeContentType(item.type)));
      return buildPortfolioSearchResult(args.query, items, args.limit ?? 12);
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
    description: 'Search Yuqi\'s published technical articles and blog posts by keyword or topic.',
    zodSchema: {
      keyword: z.string().describe('Search keyword or topic'),
      category: z.string().optional().describe('Optional category filter'),
      limit: z.number().min(1).max(20).optional().describe('Max results (1-20, default 10)'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await invokeGatewayTool('admin.search_content', {
        keyword: args.keyword,
        sourceType: 'BLOG',
        category: args.category,
        limit: Math.min(args.limit ?? 10, 20),
      });
      const items = (result?.items ?? result?.content ?? []).map(sanitizeContentItem).filter(Boolean);
      return { articles: items, total: items.length };
    },
  },

  {
    name: 'get_article',
    description: 'Get the full content of a published article by ID. Content is truncated to a configured maximum length with a link to the full article.',
    zodSchema: {
      articleId: contentIdSchema,
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await invokeGatewayTool('admin.get_content', {
        sourceType: 'BLOG',
        sourceId: args.articleId,
      });
      return sanitizeContentDetail(result) ?? { error: 'Article not found' };
    },
  },

  {
    name: 'get_profile',
    description: 'Get Yuqi\'s public professional profile including work experience, skills, education, and evidence links.',
    zodSchema: {},
    annotations: PUBLIC_ANNOTATIONS,
    handler: async () => {
      // Try to get CV/profile content from the content API
      const result = await invokeGatewayTool('admin.search_content', {
        keyword: 'Software',
        sourceType: 'EXPERIENCE',
        limit: 50,
      });
      const items = result?.items ?? result?.content ?? [];
      if (items.length === 0) {
        // Fallback: return a static-safe profile from the site
        return {
          name: 'Yuqi Guo',
          headline: 'Software Engineer',
          url: 'https://www.yuqi.site/cv',
          note: 'Full profile available at the CV page.',
        };
      }
      return sanitizeProfile({ experience: items });
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
  return score;
}

function normalizeContentType(type) {
  const normalized = String(type ?? '').toUpperCase();
  return normalized === 'LIFE' ? 'LIFE_BLOG' : normalized;
}

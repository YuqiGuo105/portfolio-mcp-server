/**
 * 6 public MCP tool definitions.
 * All tools are read-only, no-auth, non-destructive.
 * They call the existing MCP Gateway internally.
 */

import { invokeGatewayTool } from './gateway-client.js';
import { sanitizeContentItem, sanitizeContentDetail, sanitizeProfile } from './sanitize.js';
import { z } from 'zod';

/** Shared MCP tool annotations for all public tools. */
const PUBLIC_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

export const tools = [
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
      projectId: z.number().describe('Project ID'),
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
      projectId: z.number().describe('Project ID'),
    },
    annotations: PUBLIC_ANNOTATIONS,
    handler: async (args) => {
      const result = await invokeGatewayTool('admin.get_content', {
        sourceType: 'PROJECT',
        sourceId: args.projectId,
      });
      if (!result) return { error: 'Project not found' };
      // Extract architecture sections from the project body
      const body = result.body ?? result.content ?? '';
      const mermaidBlocks = [];
      const mermaidRegex = /```mermaid\n([\s\S]*?)```/g;
      let match;
      while ((match = mermaidRegex.exec(body)) !== null) {
        mermaidBlocks.push(match[1].trim());
      }
      return {
        projectId: args.projectId,
        title: result.title,
        diagrams: mermaidBlocks,
        hasDiagrams: mermaidBlocks.length > 0,
        url: sanitizeContentItem(result)?.url,
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
      articleId: z.number().describe('Article/blog post ID'),
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
        keyword: '',
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

import { createHash } from 'node:crypto';
import { z } from 'zod';

const READ_ONLY = Object.freeze({
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
});

const INTENT_ALIASES = Object.freeze({
  article: ['blog', 'content', 'publication'],
  blog: ['article', 'content', 'publication'],
  publish: ['publication', 'content', 'write'],
  search: ['find', 'query', 'lookup', 'discover'],
  find: ['search', 'query', 'lookup', 'discover'],
  visitor: ['analytics', 'traffic', 'audience'],
  traffic: ['visitor', 'analytics', 'audience'],
  retry: ['replay', 'failed', 'recovery'],
  replay: ['retry', 'failed', 'recovery'],
  knowledge: ['kb', 'rag', 'document'],
  kb: ['knowledge', 'rag', 'document'],
  resume: ['cv', 'career', 'candidate'],
  application: ['career', 'job', 'candidate'],
  alert: ['rule', 'incident', 'notification'],
  cost: ['budget', 'quota', 'spend'],
  health: ['diagnostics', 'platform', 'status'],
});

const PHRASE_ALIASES = Object.freeze({
  '文章': ['article', 'blog', 'content'],
  '发布': ['publish', 'publication', 'content'],
  '搜索': ['search', 'find', 'query'],
  '访客': ['visitor', 'analytics', 'traffic'],
  '重试': ['retry', 'replay', 'recovery'],
  '回放': ['replay', 'retry', 'recovery'],
  '知识库': ['knowledge', 'kb', 'rag'],
  '简历': ['resume', 'cv', 'career'],
  '申请': ['application', 'career', 'job'],
  '告警': ['alert', 'rule', 'incident'],
  '成本': ['cost', 'budget', 'quota'],
  '诊断': ['diagnostics', 'health', 'status'],
});

export function createDiscoveryTools(visibleTools) {
  const index = buildVisibleToolIndex(visibleTools);
  return [
    {
      name: 'catalog.search',
      description: 'Search the tools available to the current administrator by exact name, stale name, keyword, namespace, parameter, or description. Use this before guessing a tool name.',
      zodSchema: {
        query: z.string().min(1).max(500).describe('Tool name, partial name, keyword, or task description.'),
        mode: z.enum(['READ', 'WRITE']).optional().describe('Optional operation mode filter.'),
        limit: z.number().int().min(1).max(20).optional().describe('Maximum matches; default 8.'),
      },
      annotations: READ_ONLY,
      handler: async (args) => searchToolIndex(index, args, 'search'),
    },
    {
      name: 'catalog.recommend',
      description: 'Recommend the safest currently available tools for a natural-language task. Returns exact names, current inputs, permission and risk metadata, and schema fingerprints.',
      zodSchema: {
        intent: z.string().min(3).max(1000).describe('What the user wants to accomplish.'),
        mode: z.enum(['READ', 'WRITE']).optional().describe('Optional operation mode filter.'),
        limit: z.number().int().min(1).max(10).optional().describe('Maximum recommendations; default 5.'),
      },
      annotations: READ_ONLY,
      handler: async (args) => searchToolIndex(index, {
        query: args.intent,
        mode: args.mode,
        limit: args.limit ?? 5,
      }, 'recommend'),
    },
  ];
}

export function buildVisibleToolIndex(visibleTools) {
  const byName = new Map();
  for (const candidate of visibleTools || []) {
    const tool = normalizeVisibleTool(candidate);
    if (tool && !byName.has(tool.name)) byName.set(tool.name, tool);
  }
  const tools = [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
  return Object.freeze({
    tools,
    version: fingerprint(tools.map(tool => ({ name: tool.name, schema: tool.schemaFingerprint }))),
  });
}

export function searchToolIndex(index, args = {}, strategy = 'search') {
  const query = String(args.query || '').trim();
  const requestedMode = args.mode ? String(args.mode).toUpperCase() : null;
  const limit = Math.max(1, Math.min(Number(args.limit) || (strategy === 'recommend' ? 5 : 8), 20));
  const queryContext = queryTerms(query);
  const inferredWrite = strategy === 'recommend' && impliesWrite(queryContext.expanded);

  const matches = index.tools
    .filter(tool => !requestedMode || tool.mode === requestedMode)
    .map(tool => rankTool(tool, queryContext, strategy, inferredWrite))
    .filter(match => match.score > 0)
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name))
    .slice(0, limit)
    .map(({ score, reasons, searchText, ...tool }) => ({
      ...tool,
      score,
      matchReasons: reasons,
    }));

  return {
    [strategy === 'recommend' ? 'intent' : 'query']: query,
    catalogVersion: index.version,
    visibleToolCount: index.tools.length,
    matches,
    nextAction: matches.length > 0
      ? `Call ${matches[0].name} with its current schema; do not invent or prefix the tool name.`
      : 'Broaden the task description or remove the mode filter, then search again.',
  };
}

export function catalogEntries({ publicTools = [], adminTools = [], catalog = [] } = {}) {
  return [
    ...publicTools.map(tool => staticToolEntry(tool, 'PUBLIC', 'public')),
    ...adminTools.map(tool => staticToolEntry(tool, 'ADMIN', 'admin_compatibility')),
    ...catalog.map(tool => ({ ...tool, source: 'gateway_catalog' })),
  ];
}

export function registeredToolEntries(definitions, catalog = []) {
  const metadata = new Map(catalog.map(tool => [tool.name, tool]));
  return definitions.map((definition) => {
    const schema = z.toJSONSchema(definition.schema, { target: 'draft-7', io: 'input' });
    const required = new Set(schema.required || []);
    const gateway = metadata.get(definition.name);
    return {
      name: definition.name,
      description: definition.config?.description || definition.name,
      mode: gateway?.mode || (definition.config?.annotations?.readOnlyHint === false ? 'WRITE' : 'READ'),
      requiredRole: gateway?.requiredRole || 'ADMIN',
      riskLevel: gateway?.riskLevel || (definition.config?.annotations?.destructiveHint ? 'HIGH' : 'LOW'),
      confirmRequired: gateway?.confirmRequired === true,
      parameters: Object.entries(schema.properties || {}).map(([name, property]) => ({
        name,
        required: required.has(name),
        description: property?.description || '',
      })),
      source: gateway ? 'gateway_catalog' : 'mcp_registry',
    };
  });
}

function staticToolEntry(tool, requiredRole, source) {
  const parameters = Object.entries(tool.zodSchema || {}).map(([name, schema]) => ({
    name,
    required: !acceptsUndefined(schema),
    description: schema?.description || '',
  }));
  return {
    name: tool.name,
    description: tool.description,
    mode: tool.annotations?.readOnlyHint === false ? 'WRITE' : 'READ',
    requiredRole,
    riskLevel: tool.annotations?.destructiveHint ? 'HIGH' : 'LOW',
    confirmRequired: false,
    parameters,
    source,
  };
}

function normalizeVisibleTool(raw) {
  if (!raw || typeof raw.name !== 'string' || !raw.name.trim()) return null;
  const parameters = Array.isArray(raw.parameters)
    ? raw.parameters.filter(item => item?.name).map(item => ({
        name: String(item.name),
        required: item.required === true,
        description: String(item.description || ''),
      }))
    : [];
  const normalized = {
    name: raw.name,
    description: String(raw.description || raw.name),
    mode: String(raw.mode || 'READ').toUpperCase(),
    requiredRole: String(raw.requiredRole || 'ADMIN').toUpperCase(),
    riskLevel: String(raw.riskLevel || 'LOW').toUpperCase(),
    confirmRequired: raw.confirmRequired === true,
    idempotent: String(raw.mode || 'READ').toUpperCase() === 'WRITE',
    requiredInputs: parameters.filter(item => item.required).map(item => item.name),
    optionalInputs: parameters.filter(item => !item.required).map(item => item.name),
    source: raw.source || 'gateway_catalog',
  };
  normalized.schemaFingerprint = fingerprint({
    name: normalized.name,
    mode: normalized.mode,
    requiredInputs: normalized.requiredInputs,
    optionalInputs: normalized.optionalInputs,
  });
  normalized.callPattern = {
    tool: normalized.name,
    arguments: Object.fromEntries(normalized.requiredInputs.map(name => [name, `<${name}>`])),
  };
  normalized.searchText = normalizeText([
    normalized.name,
    normalized.description,
    ...parameters.flatMap(item => [item.name, item.description]),
  ].join(' '));
  return Object.freeze(normalized);
}

function rankTool(tool, query, strategy, inferredWrite) {
  const name = tool.name.toLowerCase();
  const normalizedName = normalizeText(name);
  const compactName = compact(name);
  const reasons = [];
  let score = 0;

  const alternateName = name.replaceAll('.', '_');
  const exactReference = [...query.references]
    .some(reference => reference === name
      || reference === alternateName
      || reference.endsWith(`:${name}`)
      || reference.endsWith(`_${alternateName}`));
  if (exactReference) {
    score += 1200;
    reasons.push('exact or stale tool-name match');
  } else if (query.compact === compactName) {
    score += 1000;
    reasons.push('normalized tool-name match');
  } else if (query.compact && compactName.includes(query.compact)) {
    score += 520;
    reasons.push('partial tool-name match');
  }

  const nameTokens = new Set(normalizedName.split(' ').filter(Boolean));
  const descriptionTokens = new Set(tool.searchText.split(' ').filter(Boolean));
  const parameterTokens = new Set([...tool.requiredInputs, ...tool.optionalInputs]
    .flatMap(value => normalizeText(value).split(' ')).filter(Boolean));
  const nameHits = overlap(query.expanded, nameTokens);
  const descriptionHits = overlap(query.expanded, descriptionTokens);
  const parameterHits = overlap(query.expanded, parameterTokens);
  if (nameHits > 0) {
    score += nameHits * (strategy === 'recommend' ? 95 : 130);
    reasons.push('name and namespace keywords');
  }
  if (descriptionHits > 0) {
    score += descriptionHits * (strategy === 'recommend' ? 55 : 32);
    reasons.push('task description');
  }
  if (parameterHits > 0) {
    score += parameterHits * 24;
    reasons.push('input schema');
  }

  const similarity = stringSimilarity(query.compact, compactName);
  if (similarity >= 0.72) {
    score += Math.round(similarity * 260);
    reasons.push('similar current tool name');
  }
  if (inferredWrite && tool.mode === 'WRITE') score += 35;
  if (strategy === 'recommend' && tool.mode === 'READ' && !inferredWrite) score += 12;

  return { ...tool, score, reasons: [...new Set(reasons)].slice(0, 3) };
}

function queryTerms(value) {
  const raw = String(value || '').normalize('NFKC').toLowerCase();
  const normalized = normalizeText(raw);
  const tokens = new Set(normalized.split(' ').filter(token => token.length > 1));
  for (const [phrase, aliases] of Object.entries(PHRASE_ALIASES)) {
    if (raw.includes(phrase)) aliases.forEach(alias => tokens.add(alias));
  }
  for (const token of [...tokens]) {
    (INTENT_ALIASES[token] || []).forEach(alias => tokens.add(alias));
  }
  const references = new Set([raw, raw.split(':').at(-1), raw.split(/\s+/).at(-1)]
    .filter(Boolean).map(item => item.trim()));
  for (const part of raw.match(/[a-z0-9]+(?:[._-][a-z0-9]+)+/g) || []) {
    references.add(part);
    const marker = part.lastIndexOf('_');
    if (marker > 0) references.add(part.slice(marker + 1));
  }
  return { compact: compact(raw.split(':').at(-1)), expanded: tokens, references };
}

function normalizeText(value) {
  return String(value || '').normalize('NFKC')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

function compact(value) {
  return normalizeText(value).replaceAll(' ', '');
}

function overlap(left, right) {
  let count = 0;
  for (const value of left) if (right.has(value)) count += 1;
  return count;
}

function stringSimilarity(left, right) {
  if (!left || !right) return 0;
  const longest = Math.max(left.length, right.length);
  return longest === 0 ? 1 : 1 - levenshtein(left, right) / longest;
}

function levenshtein(left, right) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let i = 1; i <= left.length; i += 1) {
    let diagonal = previous[0];
    previous[0] = i;
    for (let j = 1; j <= right.length; j += 1) {
      const upper = previous[j];
      previous[j] = Math.min(
        previous[j] + 1,
        previous[j - 1] + 1,
        diagonal + (left[i - 1] === right[j - 1] ? 0 : 1),
      );
      diagonal = upper;
    }
  }
  return previous[right.length];
}

function impliesWrite(tokens) {
  return ['write', 'create', 'update', 'delete', 'publish', 'send', 'retry', 'replay', 'rollback', 'reindex', 'set']
    .some(token => tokens.has(token));
}

function acceptsUndefined(schema) {
  try {
    return schema?.safeParse?.(undefined)?.success === true;
  } catch {
    return false;
  }
}

function fingerprint(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex').slice(0, 16);
}

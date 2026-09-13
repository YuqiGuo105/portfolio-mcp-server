import { createHash } from 'node:crypto';
import { z } from 'zod';

const registries = new WeakMap();
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export function schemaHash(schema) {
  return createHash('sha256').update(JSON.stringify(canonical(schema))).digest('hex');
}

// Capture the definitions at registration, so diagnostics validate the very same
// schemas and enabled tools as MCP, without maintaining another tool catalog.
export function createToolRegistry(server) {
  const definitions = new Map();
  const registry = {
    registerTool(name, config, handler) {
      const registered = server.registerTool(name, config, handler);
      const schema = typeof config.inputSchema?.safeParse === 'function' ? config.inputSchema : z.object(config.inputSchema || {});
      definitions.set(name, { name, schema, registered });
      return registered;
    },
    registerResource: (...args) => server.registerResource(...args),
    entries: () => [...definitions.values()].filter(d => d.registered.enabled),
  };
  registries.set(server, registry);
  return registry;
}
export const registryFor = server => registries.get(server);
export const publishedSchema = definition => z.toJSONSchema(definition.schema, { target: 'draft-7', io: 'input' });

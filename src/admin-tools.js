/**
 * Admin MCP tool definitions for alert rule management.
 * These tools are ONLY exposed via /mcp/admin (authenticated endpoint).
 *
 * Tool flow:
 *   list_alert_rules / get_alert_rule / list_alert_incidents → READ, no side effects
 *   prepare_alert_rule_change → READ, validates + returns diff preview
 *   apply_alert_rule_change → WRITE, consumes changeId, idempotent
 */

import { invokeGatewayTool } from './gateway-client.js';
import { z } from 'zod';

const ADMIN_READ_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  openWorldHint: false,
};

const ADMIN_WRITE_ANNOTATIONS = {
  readOnlyHint: false,
  destructiveHint: true,
  openWorldHint: false,
};

export const adminTools = [
  {
    name: 'list_alert_rules',
    description: 'List alert rules with optional filters by name, event type, or enabled status. Returns all matching rules with their current version.',
    zodSchema: {
      name: z.string().optional().describe('Name substring filter'),
      eventType: z.string().optional().describe('Event type filter (e.g. page_view, click)'),
      enabled: z.boolean().optional().describe('Filter by enabled/disabled'),
    },
    annotations: ADMIN_READ_ANNOTATIONS,
    handler: async (args, context) => {
      return await invokeGatewayTool('alerts.list_rules', args, context);
    },
  },

  {
    name: 'get_alert_rule',
    description: 'Get full details of a single alert rule by ID, including version, all configuration fields, and timestamps.',
    zodSchema: {
      ruleId: z.number().describe('Alert rule ID'),
    },
    annotations: ADMIN_READ_ANNOTATIONS,
    handler: async (args, context) => {
      return await invokeGatewayTool('alerts.get_rule', args, context);
    },
  },

  {
    name: 'list_alert_incidents',
    description: `List recent visitor alert incidents and notification delivery state.
Use this after a rule is active to verify whether it fired, whether delivery succeeded,
and whether any incidents are still pending notification. Filters are bounded server-side.`,
    zodSchema: {
      hours: z.number().int().min(1).max(2160).optional().describe('Lookback window in hours (1-2160, default 24)'),
      siteId: z.string().min(1).max(120).optional().describe('Optional site identifier'),
      ruleId: z.number().int().positive().optional().describe('Optional alert rule ID'),
      notified: z.boolean().optional().describe('True for delivered incidents, false for pending or failed delivery'),
      limit: z.number().int().min(1).max(200).optional().describe('Maximum incidents (1-200, default 50)'),
    },
    annotations: ADMIN_READ_ANNOTATIONS,
    handler: async (args, context) => {
      return await invokeGatewayTool('alerts.list_incidents', args, context);
    },
  },

  {
    name: 'prepare_alert_rule_change',
    description: `Validate a proposed alert rule change and return a diff preview WITHOUT modifying any data.
Returns: changeId, before/after state, diff of changed fields, warnings, expected version, and expiry time.
Supported actions: CREATE (new rule), UPDATE (modify fields), SET_ENABLED (enable/disable).
The returned changeId must be passed to apply_alert_rule_change for execution.`,
    zodSchema: {
      action: z.enum(['CREATE', 'UPDATE', 'SET_ENABLED']).describe('Type of change'),
      ruleId: z.number().optional().describe('Required for UPDATE and SET_ENABLED'),
      patch: z.object({
        siteId: z.string().min(1).max(120).optional().describe('Required for CREATE; identifies the monitored site'),
        name: z.string().optional(),
        eventType: z.string().optional(),
        geoLevel: z.enum(['GLOBAL', 'COUNTRY', 'REGION', 'METRO']).optional(),
        geoAreaId: z.string().optional().describe('Hierarchical geo ID, for example COUNTRY:US or REGION:US:TX'),
        granularity: z.enum(['5m', '1d']).optional(),
        threshold: z.number().min(0).optional(),
        comparator: z.enum(['>=', '<=']).optional(),
        cooldownSeconds: z.number().int().min(60).optional(),
        enabled: z.boolean().optional(),
      }).describe('Partial fields to change'),
      reason: z.string().min(3).max(500).describe('Human-readable reason for the change'),
    },
    annotations: ADMIN_READ_ANNOTATIONS,
    handler: async (args, context) => {
      const payload = {
        action: args.action,
        ruleId: args.ruleId,
        patch: args.patch,
        reason: args.reason,
        actor: context?.actor || 'mcp-admin',
      };
      return await invokeGatewayTool('alerts.prepare_change', payload, context);
    },
  },

  {
    name: 'apply_alert_rule_change',
    description: `Apply a previously prepared alert rule change. Only accepts the changeId returned by prepare_alert_rule_change.
The change must not be expired (5 min TTL) and is single-use. Requires an idempotency key to prevent double-execution.
Returns the final rule state with updated version number on success.`,
    zodSchema: {
      changeId: z.string().describe('Change token from prepare_alert_rule_change'),
      idempotencyKey: z.string().describe('Unique key to prevent duplicate applies (e.g. UUID)'),
    },
    annotations: ADMIN_WRITE_ANNOTATIONS,
    handler: async (args, context) => {
      return await invokeGatewayTool('alerts.apply_change', args, {
        ...context,
        idempotencyKey: args.idempotencyKey,
      });
    },
  },
];

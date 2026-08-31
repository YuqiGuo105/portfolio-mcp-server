import test from 'node:test';
import assert from 'node:assert/strict';
import { adminTools } from '../src/admin-tools.js';

function tool(name) {
  return adminTools.find((candidate) => candidate.name === name);
}

test('visitor alert MCP surface includes rule lifecycle and incident verification', () => {
  assert.ok(tool('list_alert_rules'));
  assert.ok(tool('get_alert_rule'));
  assert.ok(tool('prepare_alert_rule_change'));
  assert.ok(tool('apply_alert_rule_change'));
  assert.ok(tool('list_alert_incidents'));
  assert.equal(tool('list_alert_incidents').annotations.readOnlyHint, true);
});

test('prepare alert change validates production geo rule fields', () => {
  const schema = tool('prepare_alert_rule_change').zodSchema;
  const validPatch = schema.patch.safeParse({
    siteId: 'yuqi.site',
    name: 'Texas visitors',
    eventType: 'page_view',
    geoLevel: 'REGION',
    geoAreaId: 'REGION:US:TX',
    granularity: '5m',
    threshold: 1,
    comparator: '>=',
    cooldownSeconds: 1800,
    enabled: true,
  });
  assert.equal(validPatch.success, true);
  assert.equal(schema.reason.safeParse('').success, false);
  assert.equal(schema.patch.safeParse({ geoLevel: 'CITY' }).success, false);
});

test('incident query bounds prevent unbounded admin reads', () => {
  const schema = tool('list_alert_incidents').zodSchema;
  assert.equal(schema.hours.safeParse(24).success, true);
  assert.equal(schema.hours.safeParse(2161).success, false);
  assert.equal(schema.limit.safeParse(200).success, true);
  assert.equal(schema.limit.safeParse(201).success, false);
});

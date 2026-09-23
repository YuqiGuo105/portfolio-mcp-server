import test from 'node:test';
import assert from 'node:assert/strict';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createAdminServer } from '../src/index.js';
import {
  OperationStatus,
  operationFailed,
  operationSucceeded,
} from '../src/operation-status.js';

const writeTool = {
  name: 'publication.publish',
  mode: 'WRITE',
  description: 'Publish reviewed content.',
  requiredRole: 'PUBLISHER',
  riskLevel: 'HIGH',
  dryRunSupported: false,
  confirmRequired: true,
  confirmationMethod: '',
  parameters: [{ name: 'contentId', type: 'string', required: true }],
};

const authContext = {
  email: 'publisher@example.com',
  role: 'PUBLISHER',
  owner: false,
  operationContext: {
    traceId: 'b'.repeat(32),
    correlationId: 'operation-status-test',
    actor: 'mcp-server:admin:publisher@example.com',
  },
};

test('normalizes successful, asynchronous, and retryable operation states', () => {
  assert.equal(operationSucceeded({
    tool: writeTool,
    operationId: 'op-success',
    result: { saved: true },
  }).status, OperationStatus.SUCCEEDED);
  assert.equal(operationSucceeded({
    tool: writeTool,
    operationId: 'op-pending',
    result: { status: 'QUEUED' },
  }).status, OperationStatus.RUNNING);
  const failed = operationFailed({
    tool: writeTool,
    operationId: 'op-retry',
    error: { message: 'unavailable', statusCode: 503 },
  });
  assert.equal(failed.status, OperationStatus.RETRYABLE);
  assert.equal(failed.retryable, true);
  assert.match(failed.nextAction, /same idempotency key op-retry/);

  const uncertain = operationFailed({
    tool: writeTool,
    operationId: 'op-unknown',
    error: { message: 'timeout', details: { operation: { state: 'UNKNOWN', safeToRetry: false } } },
  });
  assert.equal(uncertain.status, OperationStatus.UNKNOWN);
  assert.equal(uncertain.retryable, false);
  assert.match(uncertain.nextAction, /do not automatically retry/);
});

test('write tools expose confirmation, operation identity and retry guidance end to end', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let responseStatus = 200;
  let responseBody = { status: 'QUEUED', jobId: 'job-42' };
  let observedIdempotencyKey = '';
  globalThis.fetch = async (url, options) => {
    assert.match(url, /publication\.publish/);
    observedIdempotencyKey = options.headers['Idempotency-Key'];
    return responseStatus === 200
      ? new Response(JSON.stringify(responseBody), { status: 200 })
      : new Response(JSON.stringify({ code: 'downstream_unavailable', message: 'Service unavailable' }), {
          status: responseStatus,
          headers: { 'Content-Type': 'application/json' },
        });
  };

  const server = await createAdminServer(authContext, async () => [writeTool]);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'operation-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const pending = await client.callTool({
      name: writeTool.name,
      arguments: { contentId: 'article-1', _idempotencyKey: 'operation-pending-1' },
    });
    assert.equal(pending.isError, true);
    assert.equal(pending.structuredContent.status, OperationStatus.WAITING_CONFIRMATION);
    assert.equal(pending.structuredContent.retryable, false);
    const operationId = pending.structuredContent.operationId;
    assert.equal(operationId, 'operation-pending-1');

    const started = await client.callTool({
      name: writeTool.name,
      arguments: {
        contentId: 'article-1',
        _confirmed: true,
        _idempotencyKey: operationId,
      },
    });
    assert.equal(started.isError, undefined);
    assert.equal(started.structuredContent.operationId, operationId);
    assert.equal(started.structuredContent.status, OperationStatus.RUNNING);
    assert.equal(started.structuredContent.retryable, false);
    assert.equal(observedIdempotencyKey, operationId);

    responseBody = { status: 'FAILED', reason: 'provider rejected the request' };
    const domainFailure = await client.callTool({
      name: writeTool.name,
      arguments: {
        contentId: 'article-2',
        _confirmed: true,
        _idempotencyKey: 'operation-domain-failure',
      },
    });
    assert.equal(domainFailure.isError, true);
    assert.equal(domainFailure.structuredContent.status, OperationStatus.FAILED_FINAL);
    assert.equal(domainFailure.structuredContent.retryable, false);

    responseStatus = 503;
    const retryable = await client.callTool({
      name: writeTool.name,
      arguments: {
        contentId: 'article-1',
        _confirmed: true,
        _idempotencyKey: operationId,
      },
    });
    assert.equal(retryable.isError, true);
    assert.equal(retryable.structuredContent.operationId, operationId);
    assert.equal(retryable.structuredContent.status, OperationStatus.RETRYABLE);
    assert.equal(retryable.structuredContent.retryable, true);
  } finally {
    await client.close();
    await server.close();
  }
});

test('compatibility write tools use the same operation envelope', async (t) => {
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response(JSON.stringify({ status: 'APPLIED', ruleId: 7 }), { status: 200 });

  const server = await createAdminServer({ ...authContext, role: 'ADMIN' }, async () => []);
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'compatibility-operation-test', version: '1.0.0' });
  await Promise.all([server.connect(serverTransport), client.connect(clientTransport)]);
  try {
    const result = await client.callTool({
      name: 'apply_alert_rule_change',
      arguments: { changeId: 'change-7', idempotencyKey: 'operation-compat-7', _confirmed: true },
    });
    assert.equal(result.structuredContent.operationId, 'operation-compat-7');
    assert.equal(result.structuredContent.status, OperationStatus.SUCCEEDED);
    assert.equal(result.structuredContent.nextAction, 'No further action is required.');
  } finally {
    await client.close();
    await server.close();
  }
});

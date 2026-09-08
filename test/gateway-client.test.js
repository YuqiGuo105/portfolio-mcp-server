import assert from 'node:assert/strict';
import test from 'node:test';

import { gatewayTimeoutForTool, invokeGatewayTool, invocationForTool } from '../src/gateway-client.js';

test('career tools receive a bounded timeout longer than their downstream adapter', () => {
  assert.equal(gatewayTimeoutForTool('career.get_active_resume_download', {}), 50_000);
  assert.equal(gatewayTimeoutForTool('content.search', {}), 40_000);
  assert.equal(gatewayTimeoutForTool('career.get_candidate_profile', {
    CAREER_GATEWAY_TIMEOUT_MS: '45000'
  }), 45_000);
});

test('writes require a caller key and preserve it on every retry', () => {
  const tool = { mode: 'WRITE' };
  const auth = { email: 'test@example.com', role: 'ADMIN' };
  assert.throws(() => invocationForTool(tool, {}, auth), /stable _idempotencyKey/);
  const args = { _idempotencyKey: 'intent-12345', title: 'Test' };
  assert.deepEqual(invocationForTool(tool, args, auth), invocationForTool(tool, args, auth));
  assert.equal(invocationForTool(tool,args,auth).context.idempotencyKey,'intent-12345');
});

test('gateway preserves structured uncertain outcomes for AI clients', async () => {
  const fetchImpl = async () => new Response(JSON.stringify({ code: 'downstream_error',
    operation: { operationId: 'op-1', state: 'UNKNOWN', safeToRetry: false } }),{ status: 502 });
  await assert.rejects(invokeGatewayTool('publication.publish',{}, { idempotencyKey: 'intent-12345' },{ fetchImpl }),error => {
    assert.equal(error.details.operation.state,'UNKNOWN');
    assert.equal(error.details.operation.safeToRetry,false);
    assert.equal(error.details.idempotencyKey,'intent-12345');
    return true;
  });
});

test('gateway aborts become actionable timeout errors', async () => {
  const fetchImpl = (_url, { signal }) => new Promise((_resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')), { once: true });
  });

  await assert.rejects(
    invokeGatewayTool('career.get_active_resume_download', {}, {}, { fetchImpl, timeoutMs: 5 }),
    /career\.get_active_resume_download gateway timed out after 5ms/
  );
});

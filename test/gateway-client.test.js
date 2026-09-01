import assert from 'node:assert/strict';
import test from 'node:test';

import { gatewayTimeoutForTool, invokeGatewayTool } from '../src/gateway-client.js';

test('career tools receive a bounded timeout longer than their downstream adapter', () => {
  assert.equal(gatewayTimeoutForTool('career.get_active_resume_download', {}), 30_000);
  assert.equal(gatewayTimeoutForTool('content.search', {}), 10_000);
  assert.equal(gatewayTimeoutForTool('career.get_candidate_profile', {
    CAREER_GATEWAY_TIMEOUT_MS: '45000'
  }), 45_000);
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

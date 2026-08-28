import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { verifyAdminAuth } from '../src/admin-auth.js';

const secret = 'a-test-secret-with-enough-entropy';

async function tokenFor(email) {
  return new SignJWT({ email })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-123')
    .setIssuedAt()
    .setExpirationTime('5m')
    .sign(new TextEncoder().encode(secret));
}

test('uses managed admin role and owner policy from admin-service', async (t) => {
  process.env.SUPABASE_JWT_SECRET = secret;
  process.env.ADMIN_SERVICE_URL = 'https://admin.test';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://admin.test/api/admin/users/me');
    assert.match(options.headers.Authorization, /^Bearer /);
    return new Response(JSON.stringify({
      email: 'owner@example.com',
      role: 'ADMIN',
      owner: true,
      permissions: ['admin.users.manage'],
      authSource: 'owner_policy',
    }), { status: 200 });
  };

  const token = await tokenFor('owner@example.com');
  const principal = await verifyAdminAuth(`Bearer ${token}`);
  assert.equal(principal.role, 'ADMIN');
  assert.equal(principal.owner, true);
  assert.deepEqual(principal.permissions, ['admin.users.manage']);
});

test('fails closed when managed authorization is unavailable', async (t) => {
  process.env.SUPABASE_JWT_SECRET = secret;
  process.env.ADMIN_SERVICE_URL = 'https://admin.test';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => new Response('unavailable', { status: 503 });
  const token = await tokenFor('owner@example.com');
  await assert.rejects(
    () => verifyAdminAuth(`Bearer ${token}`),
    error => error.statusCode === 503
  );
});

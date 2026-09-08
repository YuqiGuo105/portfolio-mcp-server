import test from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT } from 'jose';
import { verifyAdminAuth } from '../src/admin-auth.js';

const secret = 'a-test-secret-with-enough-entropy';

async function tokenFor(email, claims = {}, expiration = '5m') {
  return new SignJWT({ email, ...claims })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject('user-123')
    .setIssuedAt()
    .setExpirationTime(expiration)
    .setAudience('authenticated')
    .sign(new TextEncoder().encode(secret));
}

test('uses managed admin role and owner policy from admin-service', async (t) => {
  process.env.SUPABASE_JWT_SECRET = secret;
  delete process.env.SUPABASE_AUTH_ISSUER;
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

test('rejects missing, expired and anonymous sessions before role lookup', async (t) => {
  process.env.SUPABASE_JWT_SECRET = secret;
  delete process.env.SUPABASE_AUTH_ISSUER;
  process.env.ADMIN_SERVICE_URL = 'https://admin.test';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  globalThis.fetch = async () => { assert.fail('Invalid session must not reach authorization service'); };
  for (const header of [null, 'Bearer invalid',
    `Bearer ${await tokenFor('owner@example.com', {}, Math.floor(Date.now() / 1000) - 10)}`,
    `Bearer ${await tokenFor('owner@example.com', { is_anonymous: true })}`]) {
    await assert.rejects(() => verifyAdminAuth(header), error => error.statusCode === 401);
  }
});

test('managed role is checked again and user metadata cannot grant admin access', async (t) => {
  process.env.SUPABASE_JWT_SECRET = secret;
  delete process.env.SUPABASE_AUTH_ISSUER;
  process.env.ADMIN_SERVICE_URL = 'https://admin.test';
  process.env.ADMIN_ALLOWED_EMAILS = 'owner@example.com';
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let role = 'ADMIN';
  globalThis.fetch = async () => role === 'REVOKED'
    ? new Response('denied', { status: 403 })
    : new Response(JSON.stringify({ email: 'owner@example.com', role }), { status: 200 });
  const token = await tokenFor('owner@example.com', { user_metadata: { roles: ['ADMIN'] } });
  const header = `Bearer ${token}`;
  assert.equal((await verifyAdminAuth(header)).role, 'ADMIN');
  role = 'EDITOR';
  assert.equal((await verifyAdminAuth(header)).role, 'EDITOR');
  role = 'REVOKED';
  await assert.rejects(() => verifyAdminAuth(header), error => error.statusCode === 403);
});

test('fails closed when managed authorization is unavailable', async (t) => {
  process.env.SUPABASE_JWT_SECRET = secret;
  delete process.env.SUPABASE_AUTH_ISSUER;
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

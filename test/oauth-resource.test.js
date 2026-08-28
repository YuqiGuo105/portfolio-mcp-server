import test from 'node:test';
import assert from 'node:assert/strict';
import {
  adminResourceUrl,
  bearerChallenge,
  protectedResourceMetadata,
  protectedResourceMetadataUrl,
} from '../src/oauth-resource.js';
import { createHttpServer } from '../src/index.js';

test('publishes OAuth protected-resource metadata for the admin MCP endpoint', () => {
  process.env.SITE_URL = 'https://www.yuqi.site/';
  process.env.SUPABASE_AUTH_ISSUER = 'https://project.supabase.co/auth/v1/';

  assert.equal(adminResourceUrl(), 'https://www.yuqi.site/mcp/admin');
  assert.deepEqual(protectedResourceMetadata(), {
    resource: 'https://www.yuqi.site/mcp/admin',
    authorization_servers: ['https://project.supabase.co/auth/v1'],
    scopes_supported: ['email', 'profile'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/YuqiGuo105/portfolio-mcp-server/blob/main/docs/CLIENT_INTEGRATIONS.md',
  });
});

test('builds an RFC 9728 bearer challenge without exposing credentials', () => {
  process.env.SITE_URL = 'https://www.yuqi.site';
  process.env.MCP_SERVER_PUBLIC_URL = 'https://portfolio-mcp-server.example.run.app';
  delete process.env.MCP_RESOURCE_ORIGIN;
  assert.equal(
    protectedResourceMetadataUrl(),
    'https://www.yuqi.site/.well-known/oauth-protected-resource/mcp/admin'
  );
  assert.equal(
    bearerChallenge(),
    'Bearer resource_metadata="https://www.yuqi.site/.well-known/oauth-protected-resource/mcp/admin", scope="email profile"'
  );
});

test('unauthenticated admin MCP requests advertise OAuth discovery', async (t) => {
  process.env.SITE_URL = 'https://www.yuqi.site';
  process.env.MCP_SERVER_PUBLIC_URL = 'https://portfolio-mcp-server.example.run.app';
  delete process.env.MCP_RESOURCE_ORIGIN;
  const server = createHttpServer();
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());

  const { port } = server.address();
  const response = await fetch(`http://127.0.0.1:${port}/mcp/admin`);
  assert.equal(response.status, 401);
  assert.equal(
    response.headers.get('www-authenticate'),
    'Bearer resource_metadata="https://www.yuqi.site/.well-known/oauth-protected-resource/mcp/admin", scope="email profile"'
  );
});

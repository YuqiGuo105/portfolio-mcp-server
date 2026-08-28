const DEFAULT_SITE_URL = 'https://www.yuqi.site';

function trimTrailingSlash(value) {
  return String(value || '').replace(/\/+$/, '');
}

export function adminResourceUrl() {
  return `${trimTrailingSlash(process.env.SITE_URL || DEFAULT_SITE_URL)}/mcp/admin`;
}

export function protectedResourceMetadataUrl() {
  const metadataOrigin = trimTrailingSlash(
    process.env.MCP_SERVER_PUBLIC_URL || process.env.SITE_URL || DEFAULT_SITE_URL
  );
  return `${metadataOrigin}/.well-known/oauth-protected-resource/mcp/admin`;
}

export function authorizationServerIssuer() {
  return trimTrailingSlash(process.env.SUPABASE_AUTH_ISSUER);
}

export function protectedResourceMetadata() {
  const issuer = authorizationServerIssuer();
  return {
    resource: adminResourceUrl(),
    ...(issuer ? { authorization_servers: [issuer] } : {}),
    scopes_supported: ['openid', 'email', 'profile'],
    bearer_methods_supported: ['header'],
    resource_documentation: 'https://github.com/YuqiGuo105/portfolio-mcp-server/blob/main/docs/CLIENT_INTEGRATIONS.md',
  };
}

export function bearerChallenge() {
  return `Bearer resource_metadata="${protectedResourceMetadataUrl()}", scope="openid email profile"`;
}

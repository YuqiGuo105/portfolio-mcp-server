/**
 * Admin authentication middleware.
 * Verifies Supabase JWT from Authorization header and checks admin role.
 *
 * Env:
 *   SUPABASE_AUTH_ISSUER      – Supabase Auth issuer for JWKS verification
 *   SUPABASE_JWT_SECRET       – legacy HS256 verification fallback
 *   ADMIN_ALLOWED_EMAILS      – comma-separated list of allowed admin emails
 */

import {
  createRemoteJWKSet,
  decodeProtectedHeader,
  jwtVerify,
} from 'jose';

const jwksByIssuer = new Map();

/**
 * Verify the Supabase JWT and return decoded claims if the user is an admin.
 * Throws if auth fails.
 *
 * @param {string|null} authorizationHeader - "Bearer <token>"
 * @returns {{ email: string, sub: string, role: string }}
 */
export async function verifyAdminAuth(authorizationHeader) {
  const adminEmails = (process.env.ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or invalid Authorization header');
  }
  const token = authorizationHeader.slice(7);
  const payload = await verifySupabaseToken(token);

  const email = (payload.email || '').toLowerCase();
  const managedPrincipal = await resolveManagedPrincipal(authorizationHeader);
  if (managedPrincipal) {
    if (String(managedPrincipal.email || '').toLowerCase() !== email) {
      throw new AuthError(403, 'Admin identity mismatch');
    }
    const role = String(managedPrincipal.role || '').toUpperCase();
    if (!['EDITOR', 'PUBLISHER', 'ADMIN'].includes(role)) {
      throw new AuthError(403, 'Invalid managed admin role');
    }
    return {
      email,
      sub: payload.sub,
      role,
      owner: managedPrincipal.owner === true,
      permissions: Array.isArray(managedPrincipal.permissions) ? managedPrincipal.permissions : [],
      authSource: managedPrincipal.authSource || 'managed_admin',
      accessToken: token,
    };
  }

  if (adminEmails.length === 0 || !adminEmails.includes(email)) {
    throw new AuthError(403, 'Not an authorized admin: ' + email);
  }
  return {
    email,
    sub: payload.sub,
    role: 'ADMIN',
    owner: false,
    permissions: ['admin.read', 'content.write', 'content.publish', 'operations.manage'],
    authSource: 'environment_fallback',
    accessToken: token,
  };
}

async function verifySupabaseToken(token) {
  const issuer = String(process.env.SUPABASE_AUTH_ISSUER || '').replace(/\/+$/, '');
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || '';

  let algorithm;
  try {
    algorithm = decodeProtectedHeader(token).alg;
  } catch {
    throw new AuthError(401, 'Invalid access token');
  }

  try {
    if (algorithm === 'HS256') {
      if (!jwtSecret) {
        throw new AuthError(500, 'SUPABASE_JWT_SECRET not configured');
      }
      const result = await jwtVerify(token, new TextEncoder().encode(jwtSecret), {
        algorithms: ['HS256'],
        ...(issuer ? { issuer } : {}),
        audience: 'authenticated',
      });
      return result.payload;
    }

    if (!issuer) {
      throw new AuthError(500, 'SUPABASE_AUTH_ISSUER not configured');
    }
    if (!['RS256', 'ES256'].includes(algorithm)) {
      throw new AuthError(401, 'Unsupported access token algorithm');
    }

    let jwks = jwksByIssuer.get(issuer);
    if (!jwks) {
      jwks = createRemoteJWKSet(new URL(`${issuer}/.well-known/jwks.json`));
      jwksByIssuer.set(issuer, jwks);
    }
    const result = await jwtVerify(token, jwks, {
      algorithms: ['RS256', 'ES256'],
      issuer,
      audience: 'authenticated',
    });
    return result.payload;
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(401, 'Invalid or expired access token');
  }
}

async function resolveManagedPrincipal(authorizationHeader) {
  const baseUrl = (process.env.ADMIN_SERVICE_URL || '').replace(/\/+$/, '');
  if (!baseUrl) return null;

  const controller = new AbortController();
  const timeoutMs = Number(process.env.ADMIN_AUTH_TIMEOUT_MS) || 5_000;
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(`${baseUrl}/api/admin/users/me`, {
      headers: { Authorization: authorizationHeader },
      signal: controller.signal,
    });
    if (response.status === 401) throw new AuthError(401, 'Admin session expired');
    if (response.status === 403) throw new AuthError(403, 'Admin access denied');
    if (!response.ok) throw new AuthError(503, 'Admin authorization service unavailable');
    return await response.json();
  } catch (error) {
    if (error instanceof AuthError) throw error;
    throw new AuthError(503, 'Admin authorization service unavailable');
  } finally {
    clearTimeout(timer);
  }
}

export class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

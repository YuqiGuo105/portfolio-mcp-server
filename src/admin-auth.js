/**
 * Admin authentication middleware.
 * Verifies Supabase JWT from Authorization header and checks admin role.
 *
 * Env:
 *   SUPABASE_JWT_SECRET       – HS256 secret for verifying Supabase JWTs
 *   ADMIN_ALLOWED_EMAILS      – comma-separated list of allowed admin emails
 */

import { jwtVerify } from 'jose';

/**
 * Verify the Supabase JWT and return decoded claims if the user is an admin.
 * Throws if auth fails.
 *
 * @param {string|null} authorizationHeader - "Bearer <token>"
 * @returns {{ email: string, sub: string, role: string }}
 */
export async function verifyAdminAuth(authorizationHeader) {
  const jwtSecret = process.env.SUPABASE_JWT_SECRET || '';
  const adminEmails = (process.env.ADMIN_ALLOWED_EMAILS || '')
    .split(',')
    .map(e => e.trim().toLowerCase())
    .filter(Boolean);
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or invalid Authorization header');
  }
  if (!jwtSecret) {
    throw new AuthError(500, 'SUPABASE_JWT_SECRET not configured');
  }

  const token = authorizationHeader.slice(7);
  const secret = new TextEncoder().encode(jwtSecret);

  let payload;
  try {
    const result = await jwtVerify(token, secret, {
      algorithms: ['HS256'],
    });
    payload = result.payload;
  } catch (err) {
    throw new AuthError(401, 'Invalid or expired token: ' + err.message);
  }

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

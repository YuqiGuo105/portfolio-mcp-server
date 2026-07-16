/**
 * Admin authentication middleware.
 * Verifies Supabase JWT from Authorization header and checks admin role.
 *
 * Env:
 *   SUPABASE_JWT_SECRET       – HS256 secret for verifying Supabase JWTs
 *   ADMIN_ALLOWED_EMAILS      – comma-separated list of allowed admin emails
 */

import { jwtVerify } from 'jose';

const JWT_SECRET = process.env.SUPABASE_JWT_SECRET || '';
const ADMIN_EMAILS = (process.env.ADMIN_ALLOWED_EMAILS || '')
  .split(',')
  .map(e => e.trim().toLowerCase())
  .filter(Boolean);

/**
 * Verify the Supabase JWT and return decoded claims if the user is an admin.
 * Throws if auth fails.
 *
 * @param {string|null} authorizationHeader - "Bearer <token>"
 * @returns {{ email: string, sub: string, role: string }}
 */
export async function verifyAdminAuth(authorizationHeader) {
  if (!authorizationHeader || !authorizationHeader.startsWith('Bearer ')) {
    throw new AuthError(401, 'Missing or invalid Authorization header');
  }
  if (!JWT_SECRET) {
    throw new AuthError(500, 'SUPABASE_JWT_SECRET not configured');
  }

  const token = authorizationHeader.slice(7);
  const secret = new TextEncoder().encode(JWT_SECRET);

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
  if (ADMIN_EMAILS.length > 0 && !ADMIN_EMAILS.includes(email)) {
    throw new AuthError(403, 'Not an authorized admin: ' + email);
  }

  return {
    email,
    sub: payload.sub,
    role: 'ADMIN',
  };
}

export class AuthError extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
  }
}

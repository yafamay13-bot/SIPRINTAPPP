import { cookies } from 'next/headers';
import { SignJWT, jwtVerify } from 'jose';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { db } from './db.js';

const COOKIE = 'siprint_session';
const TTL = 60 * 60 * 8;

function secret() {
  const value = process.env.SESSION_SECRET;
  if (!value || value.length < 32) throw new Error('SESSION_SECRET must contain at least 32 characters');
  return new TextEncoder().encode(value);
}

export function newCsrfToken() {
  return randomBytes(32).toString('base64url');
}

export function safeEqual(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string') return false;
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function startSession(user) {
  const csrf = newCsrfToken();
  const token = await new SignJWT({ av: Number(user.auth_version), csrf })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(String(user.id))
    .setIssuer('siprint')
    .setAudience('siprint-web')
    .setIssuedAt()
    .setExpirationTime(`${TTL}s`)
    .sign(secret());
  const jar = await cookies();
  jar.set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'strict',
    path: '/',
    maxAge: TTL,
  });
  return csrf;
}

export async function endSession() {
  const jar = await cookies();
  jar.delete(COOKIE);
}

export async function getSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  if (!token) return null;
  const key = secret();
  let payload;
  try {
    ({ payload } = await jwtVerify(token, key, {
      issuer: 'siprint',
      audience: 'siprint-web',
      algorithms: ['HS256'],
    }));
  } catch {
    return null;
  }
  const [user] = await db()`
    SELECT id, name, email, role, is_active, auth_version, profile_photo
    FROM users WHERE id = ${payload.sub} LIMIT 1`;
  if (!user || !user.is_active || Number(user.auth_version) !== Number(payload.av)) return null;
  return { user, csrf: payload.csrf };
}

export async function requireUser(role) {
  const session = await getSession();
  if (!session) return null;
  if (role && session.user.role !== role) return null;
  return session;
}

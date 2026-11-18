import { createHmac } from 'node:crypto';

export function canonicalOrigin(request) {
  const configured = process.env.APP_URL;
  if (!configured) {
    if (process.env.NODE_ENV === 'production') throw new Error('APP_URL is required in production');
    return request.nextUrl.origin;
  }
  return new URL(configured).origin;
}

export function sameOrigin(request) {
  const origin = request.headers.get('origin');
  if (!origin) return false;
  try {
    return new URL(origin).origin === canonicalOrigin(request);
  } catch {
    return false;
  }
}

export function clientIp(request) {
  return request.headers.get('x-real-ip') || request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
}

export function ipHash(ip) {
  const secret = process.env.SESSION_SECRET;
  if (!secret || secret.length < 32) throw new Error('SESSION_SECRET is not configured');
  return createHmac('sha256', secret).update(ip).digest('hex');
}

export function safeInternalLink(value) {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//')
    && !value.includes('\\') && !/[\r\n]/.test(value);
}

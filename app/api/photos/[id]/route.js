import { NextResponse } from 'next/server';
import { db } from '../../../../lib/db.js';
import { getSession } from '../../../../lib/session.js';
import { photoPath, readPrivateObject } from '../../../../lib/storage.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(_request, { params }) {
  const session = await getSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await params;
  if (session.user.role !== 'admin' && String(session.user.id) !== String(id)) {
    return new NextResponse('Not found', { status: 404 });
  }
  const [user] = await db()`SELECT profile_photo FROM users WHERE id = ${id}`;
  const name = user?.profile_photo;
  if (!name || !/^[0-9a-f-]{36}\.(?:jpg|png|webp)$/i.test(name)) return new NextResponse('Not found', { status: 404 });
  const file = await readPrivateObject(photoPath(name));
  if (!file) return new NextResponse('Not found', { status: 404 });
  const ext = name.split('.').pop();
  const type = ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg';
  return new NextResponse(file.bytes, {
    headers: {
      'Content-Type': type,
      'Content-Length': String(file.bytes.length),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; sandbox",
    },
  });
}

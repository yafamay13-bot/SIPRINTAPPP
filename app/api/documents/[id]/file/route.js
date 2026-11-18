import { NextResponse } from 'next/server';
import { db } from '../../../../../lib/db.js';
import { getSession } from '../../../../../lib/session.js';
import { documentPath, readPrivateObject } from '../../../../../lib/storage.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request, { params }) {
  const session = await getSession();
  if (!session) return new NextResponse('Unauthorized', { status: 401 });
  const { id } = await params;
  const [document] = await db()`SELECT id, user_id, original_filename, stored_filename
    FROM documents WHERE id = ${id}`;
  if (!document || (session.user.role !== 'admin' && String(document.user_id) !== String(session.user.id))) {
    return new NextResponse('Not found', { status: 404 });
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i.test(document.stored_filename || '')) {
    return new NextResponse('Not found', { status: 404 });
  }
  const file = await readPrivateObject(documentPath(document.stored_filename));
  if (!file || file.bytes.subarray(0, 5).toString('ascii') !== '%PDF-') {
    return new NextResponse('Not found', { status: 404 });
  }
  const download = request.nextUrl.searchParams.get('download') === '1';
  const safeName = document.original_filename.replace(/[\x00-\x1f\x7f"\\]/g, '_').slice(0, 255);
  return new NextResponse(file.bytes, {
    headers: {
      'Content-Type': 'application/pdf',
      'Content-Length': String(file.bytes.length),
      'Content-Disposition': `${download ? 'attachment' : 'inline'}; filename="${safeName}"; filename*=UTF-8''${encodeURIComponent(document.original_filename)}`,
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'self'; sandbox",
    },
  });
}

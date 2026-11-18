import { NextResponse } from 'next/server';
import { handleUpload } from '@vercel/blob/client';
import { getSession, safeEqual } from '../../../../lib/session.js';
import { sameOrigin } from '../../../../lib/security.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PDF = 15 * 1024 * 1024;
const DOCUMENT_PATH = /^documents\/[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.pdf$/i;

export async function POST(request) {
  try {
    const body = await request.json();
    const response = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname, clientPayload) => {
        if (!sameOrigin(request)) throw new Error('Invalid origin');
        const session = await getSession();
        if (!session || session.user.role !== 'pegawai') throw new Error('Unauthorized');
        if (!safeEqual(clientPayload, session.csrf)) throw new Error('Invalid CSRF token');
        if (!DOCUMENT_PATH.test(pathname)) throw new Error('Invalid upload path');

        return {
          allowedContentTypes: ['application/pdf'],
          maximumSizeInBytes: MAX_PDF,
          validUntil: Date.now() + 10 * 60 * 1000,
          addRandomSuffix: false,
          allowOverwrite: false,
          tokenPayload: JSON.stringify({ userId: String(session.user.id) }),
        };
      },
    });
    return NextResponse.json(response);
  } catch {
    return NextResponse.json({ error: 'Unggahan tidak diizinkan atau gagal.' }, { status: 400 });
  }
}

import { del, get, put } from '@vercel/blob';

export async function uploadPrivateObject(path, body, contentType) {
  return put(path, body, {
    access: 'private',
    contentType,
    addRandomSuffix: false,
    allowOverwrite: false,
  });
}

export async function readPrivateObject(path) {
  const result = await get(path, { access: 'private' });
  if (!result || result.statusCode !== 200 || !result.stream) return null;
  const bytes = Buffer.from(await new Response(result.stream).arrayBuffer());
  return { bytes, contentType: result.blob.contentType };
}

export async function deletePrivateObject(path) {
  await del(path);
}

export function documentPath(filename) {
  return `documents/${filename}`;
}

export function photoPath(filename) {
  return `profiles/${filename}`;
}

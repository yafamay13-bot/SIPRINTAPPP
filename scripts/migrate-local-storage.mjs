import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { put } from '@vercel/blob';
import { db } from '../lib/db.js';

if (!process.env.BLOB_READ_WRITE_TOKEN) {
  throw new Error('Set BLOB_READ_WRITE_TOKEN in the process environment.');
}

const sql = db();
const roots = [
  { directory: path.resolve('storage', 'uploads'), prefix: 'documents', query: sql`SELECT DISTINCT stored_filename AS name FROM documents` },
  { directory: path.resolve('storage', 'profile-photos'), prefix: 'profiles', query: sql`SELECT DISTINCT profile_photo AS name FROM users WHERE profile_photo IS NOT NULL` },
];

async function upload(prefix, name, localPath) {
  const bytes = await readFile(localPath);
  const type = name.toLowerCase().endsWith('.pdf') ? 'application/pdf'
    : name.toLowerCase().endsWith('.png') ? 'image/png'
      : name.toLowerCase().endsWith('.webp') ? 'image/webp' : 'image/jpeg';
  await put(`${prefix}/${name}`, bytes, {
    access: 'private',
    contentType: type,
    addRandomSuffix: false,
    allowOverwrite: true,
    multipart: bytes.length > 4 * 1024 * 1024,
  });
}

let copied = 0;
let missing = 0;
try {
  for (const root of roots) {
    const referenced = await root.query;
    const names = new Set((await readdir(root.directory).catch((error) => {
      if (error.code === 'ENOENT') return [];
      throw error;
    })));
    for (const row of referenced) {
      const name = row.name;
      if (typeof name !== 'string' || path.basename(name) !== name || !/^[0-9a-f-]{36}\.(pdf|jpg|png|webp)$/i.test(name)) continue;
      if (!names.has(name)) {
        missing++;
        continue;
      }
      await upload(root.prefix, name, path.join(root.directory, name));
      copied++;
    }
  }
  console.log(`Copied ${copied} referenced file(s) to the private Vercel Blob store; ${missing} referenced file(s) were missing locally. Local files were not changed.`);
} finally {
  await sql.end();
}

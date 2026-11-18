import bcrypt from 'bcryptjs';
import { db } from '../lib/db.js';

const { ADMIN_NAME, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
if (!ADMIN_NAME || !ADMIN_EMAIL || !ADMIN_PASSWORD) {
  throw new Error('Set ADMIN_NAME, ADMIN_EMAIL, and ADMIN_PASSWORD in the process environment.');
}
if (Buffer.byteLength(ADMIN_PASSWORD, 'utf8') > 72 || [...ADMIN_PASSWORD].length < 16) {
  throw new Error('ADMIN_PASSWORD must be at least 16 characters and no more than 72 bytes.');
}
const email = ADMIN_EMAIL.trim().toLowerCase();
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || [...ADMIN_NAME.trim()].length < 2) {
  throw new Error('ADMIN_NAME or ADMIN_EMAIL is invalid.');
}
const sql = db();
try {
  const inserted = await sql.begin(async (tx) => {
    const [lock] = await tx`SELECT GET_LOCK('siprint_first_admin', 10) AS acquired`;
    if (Number(lock.acquired) !== 1) throw new Error('Could not lock administrator setup; no account was changed.');
    try {
      const [existing] = await tx`SELECT id FROM users WHERE role='admin' LIMIT 1`;
      if (existing) throw new Error('An administrator already exists; no account was changed.');
      const [user] = await tx`INSERT INTO users (name,email,password_hash,role)
        VALUES (${ADMIN_NAME.trim()},${email},${await bcrypt.hash(ADMIN_PASSWORD,12)},'admin')`;
      await tx`INSERT INTO audit_logs (user_id,action,entity_type,entity_id,details)
        VALUES (${user.insertId},'admin_created','user',${user.insertId},${JSON.stringify({ email })})`;
      return { id: user.insertId };
    } finally {
      await tx`SELECT RELEASE_LOCK('siprint_first_admin')`;
    }
  });
  console.log(`Created the first SIPRINT administrator (user ID ${inserted.id}).`);
} finally {
  await sql.end();
}

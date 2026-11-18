import { NextResponse } from 'next/server';
import bcrypt from 'bcryptjs';
import { randomUUID } from 'node:crypto';
import { db, audit } from '../../../lib/db.js';
import { endSession, getSession, safeEqual, startSession } from '../../../lib/session.js';
import { clientIp, ipHash, safeInternalLink, sameOrigin } from '../../../lib/security.js';
import { deletePrivateObject, documentPath, photoPath, readPrivateObject, uploadPrivateObject } from '../../../lib/storage.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_PDF = 15 * 1024 * 1024;
const MAX_PHOTO = 2 * 1024 * 1024;

function redirect(request, path, notice) {
  const url = new URL(path, request.url);
  if (notice) url.searchParams.set('notice', notice);
  return NextResponse.redirect(url, { status: 303 });
}

function json(message, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function value(form, key) {
  return rawValue(form, key).trim();
}

function rawValue(form, key) {
  const entry = form.get(key);
  return typeof entry === 'string' ? entry : '';
}

function validPassword(password, minimum = 12) {
  return typeof password === 'string' && [...password].length >= minimum && Buffer.byteLength(password, 'utf8') <= 72;
}

function validName(name) {
  return [...name].length >= 2 && [...name].length <= 120;
}

function validEmail(email) {
  return email.length <= 190 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function validPdf(bytes) {
  return bytes.length >= 5 && bytes.subarray(0, 5).toString('ascii') === '%PDF-';
}

function validImage(bytes, ext) {
  if (ext === 'jpg' || ext === 'jpeg') return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (ext === 'png') return bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  return ext === 'webp' && bytes.length >= 12 && bytes.subarray(0, 4).toString() === 'RIFF' && bytes.subarray(8, 12).toString() === 'WEBP';
}

function filenameAllowed(name, suffix) {
  return typeof name === 'string' && new RegExp(`^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\\.${suffix}$`, 'i').test(name);
}

async function postForm(request) {
  const form = await request.formData();
  const action = value(form, 'action');
  const ip = clientIp(request);
  if (!sameOrigin(request)) return json('Permintaan lintas origin ditolak.', 403);

  if (action !== 'login') {
    const session = await getSession();
    if (!session) return redirect(request, '/login', 'Sesi Anda berakhir. Silakan masuk kembali.');
    if (!safeEqual(value(form, '_csrf'), session.csrf)) return json('Token keamanan tidak valid. Muat ulang halaman.', 403);
    const user = session.user;
    const isAdmin = user.role === 'admin';
    const requireRole = (role) => user.role === role;

    if (action === 'logout') {
      await audit(user.id, 'logout', 'session', null, {}, ip);
      await endSession();
      return redirect(request, '/login', 'Anda telah keluar.');
    }

    if (action === 'profile') {
      const name = value(form, 'name');
      const email = value(form, 'email').toLowerCase();
      const currentPassword = rawValue(form, 'current_password');
      const newPassword = rawValue(form, 'new_password');
      const confirmPassword = rawValue(form, 'confirm_password');
      if (!validName(name) || !validEmail(email)) return redirect(request, '/profil', 'Nama atau email tidak valid.');
      if (newPassword && (!validPassword(newPassword) || newPassword !== confirmPassword)) {
        return redirect(request, '/profil', 'Kata sandi baru harus minimal 12 karakter dan konfirmasinya harus cocok.');
      }
      if (!newPassword && confirmPassword) return redirect(request, '/profil', 'Konfirmasi hanya diisi ketika mengganti kata sandi.');
      try {
        await db().begin(async (tx) => {
          const [account] = await tx`SELECT password_hash, auth_version FROM users WHERE id = ${user.id} AND is_active = TRUE FOR UPDATE`;
          if (!account) throw new Error('ACCOUNT_INACTIVE');
          let passwordHash = account.password_hash;
          if (newPassword) {
            if (!currentPassword || !(await bcrypt.compare(currentPassword, passwordHash))) throw new Error('CURRENT_PASSWORD');
            passwordHash = await bcrypt.hash(newPassword, 12);
            await tx`UPDATE users SET name = ${name}, email = ${email}, password_hash = ${passwordHash}, auth_version = auth_version + 1 WHERE id = ${user.id}`;
          } else {
            await tx`UPDATE users SET name = ${name}, email = ${email} WHERE id = ${user.id}`;
          }
          await tx`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (${user.id}, ${newPassword ? 'profile_and_password_updated' : 'profile_updated'}, 'user', ${user.id},
            ${JSON.stringify({ email, passwordChanged: Boolean(newPassword) })}, ${ip})`;
        });
        if (newPassword) {
          await startSession({ ...user, auth_version: Number(user.auth_version) + 1 });
        }
        return redirect(request, '/profil', 'Profil berhasil diperbarui.');
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return redirect(request, '/profil', 'Email tersebut sudah digunakan oleh akun lain.');
        if (error.message === 'CURRENT_PASSWORD') return redirect(request, '/profil', 'Kata sandi saat ini tidak sesuai.');
        if (error.message === 'ACCOUNT_INACTIVE') return redirect(request, '/login', 'Akun tidak aktif.');
        throw error;
      }
    }

    if (action === 'photo') {
      const file = form.get('profile_photo');
      if (!(file instanceof File) || !file.size) return redirect(request, '/profil', 'Pilih foto profil terlebih dahulu.');
      if (file.size > MAX_PHOTO) return redirect(request, '/profil', 'Ukuran foto maksimal 2 MB.');
      const ext = (file.name.split('.').pop() || '').toLowerCase();
      const bytes = Buffer.from(await file.arrayBuffer());
      if (!['jpg', 'jpeg', 'png', 'webp'].includes(ext) || !validImage(bytes, ext)) {
        return redirect(request, '/profil', 'Isi file tidak valid sebagai foto JPG, PNG, atau WebP.');
      }
      const stored = `${randomUUID()}.${ext === 'jpeg' ? 'jpg' : ext}`;
      const path = photoPath(stored);
      await uploadPrivateObject(path, bytes, ext === 'png' ? 'image/png' : ext === 'webp' ? 'image/webp' : 'image/jpeg');
      let previous;
      try {
        await db().begin(async (tx) => {
          const [account] = await tx`SELECT profile_photo FROM users WHERE id = ${user.id} AND is_active = TRUE FOR UPDATE`;
          if (!account) throw new Error('ACCOUNT_INACTIVE');
          previous = account.profile_photo;
          await tx`UPDATE users SET profile_photo = ${stored} WHERE id = ${user.id}`;
          await tx`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, ip_address)
            VALUES (${user.id}, 'profile_photo_updated', 'user', ${user.id}, ${ip})`;
        });
      } catch (error) {
        await deletePrivateObject(path);
        if (error.message === 'ACCOUNT_INACTIVE') return redirect(request, '/login', 'Akun tidak aktif.');
        throw error;
      }
      if (filenameAllowed(previous, '(?:jpg|png|webp)')) await deletePrivateObject(photoPath(previous));
      return redirect(request, '/profil', 'Foto profil berhasil diperbarui.');
    }

    if (action === 'prepare-document-upload') {
      if (!requireRole('pegawai')) return json('Akses ditolak.', 403);
      const filename = `${randomUUID()}.pdf`;
      return NextResponse.json({ filename }, {
        headers: { 'Cache-Control': 'no-store' },
      });
    }

    if (action === 'complete-document-upload') {
      if (!requireRole('pegawai')) return json('Akses ditolak.', 403);
      const title = value(form, 'title');
      const copies = Number(value(form, 'copies'));
      const notes = value(form, 'notes');
      const originalName = (value(form, 'original_filename').replace(/\\/g, '/').split('/').pop() || '').slice(0, 255);
      const stored = value(form, 'stored_filename');
      if (title.length < 2 || title.length > 160 || !Number.isInteger(copies) || copies < 1 || copies > 500
        || notes.length > 1000 || !originalName.toLowerCase().endsWith('.pdf') || !filenameAllowed(stored, 'pdf')) {
        return redirect(request, '/dokumen/baru', 'Periksa nama, jumlah salinan, keterangan, dan file PDF.');
      }
      const object = await readPrivateObject(documentPath(stored));
      if (!object || object.bytes.length > MAX_PDF || !validPdf(object.bytes)) {
        if (object) await deletePrivateObject(documentPath(stored));
        return redirect(request, '/dokumen/baru', 'PDF tidak valid, lebih besar dari 15 MB, atau tidak tersedia.');
      }
      try {
        await db().begin(async (tx) => {
          const [inserted] = await tx`INSERT INTO documents (user_id, title, copies, notes, original_filename, stored_filename, file_size)
            VALUES (${user.id}, ${title}, ${copies}, ${notes || null}, ${originalName}, ${stored}, ${object.bytes.length})`;
          await tx`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (${user.id}, 'document_submitted', 'document', ${inserted.insertId},
            ${JSON.stringify({ title, copies })}, ${ip})`;
          await tx`INSERT INTO notifications (user_id, title, message, link)
            SELECT id, 'Dokumen baru masuk', ${`${user.name} mengirim dokumen “${title}”.`}, '/admin/antrean'
            FROM users WHERE role = 'admin' AND is_active = TRUE`;
        });
        return redirect(request, '/dokumen', 'Dokumen berhasil dikirim dan masuk ke antrean admin.');
      } catch (error) {
        await deletePrivateObject(documentPath(stored));
        throw error;
      }
    }

    if (action === 'notification-read-all') {
      await db()`UPDATE notifications SET is_read = TRUE, read_at = CURRENT_TIMESTAMP
        WHERE user_id = ${user.id} AND is_read = FALSE`;
      return redirect(request, '/notifikasi', 'Semua notifikasi ditandai sudah dibaca.');
    }
    if (action === 'notification-read') {
      const id = value(form, 'id');
      const [notification] = await db()`SELECT link FROM notifications WHERE id = ${id} AND user_id = ${user.id}`;
      if (!notification) return redirect(request, '/notifikasi', 'Notifikasi tidak ditemukan.');
      await db()`UPDATE notifications SET is_read = TRUE, read_at = COALESCE(read_at, CURRENT_TIMESTAMP)
        WHERE id = ${id} AND user_id = ${user.id}`;
      return redirect(request, safeInternalLink(notification.link) ? notification.link : '/notifikasi');
    }
    if (action === 'employee-create') {
      if (!isAdmin) return json('Akses ditolak.', 403);
      const name = value(form, 'name');
      const email = value(form, 'email').toLowerCase();
      const password = rawValue(form, 'password');
      if (!validName(name) || !validEmail(email) || !validPassword(password)) {
        return redirect(request, '/admin/pegawai', 'Isi nama, email valid, dan kata sandi minimal 12 karakter.');
      }
      try {
        await db().begin(async (tx) => {
          const [employee] = await tx`INSERT INTO users (name, email, password_hash, role)
            VALUES (${name}, ${email}, ${await bcrypt.hash(password, 12)}, 'pegawai')`;
          await tx`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (${user.id}, 'employee_created', 'user', ${employee.insertId}, ${JSON.stringify({ email })}, ${ip})`;
        });
        return redirect(request, '/admin/pegawai', 'Akun pegawai berhasil dibuat.');
      } catch (error) {
        if (error.code === 'ER_DUP_ENTRY') return redirect(request, '/admin/pegawai', 'Email tersebut sudah digunakan.');
        throw error;
      }
    }
    if (action === 'employee-toggle') {
      if (!isAdmin) return json('Akses ditolak.', 403);
      const id = value(form, 'id');
      const employee = await db().begin(async (tx) => {
        const [current] = await tx`SELECT is_active FROM users WHERE id = ${id} AND role = 'pegawai' FOR UPDATE`;
        if (!current) return null;
        const isActive = !Boolean(current.is_active);
        await tx`UPDATE users SET is_active = ${isActive}, auth_version = auth_version + 1 WHERE id = ${id}`;
        return { is_active: isActive };
      });
      if (!employee) return redirect(request, '/admin/pegawai', 'Akun pegawai tidak ditemukan.');
      await audit(user.id, employee.is_active ? 'employee_activated' : 'employee_deactivated', 'user', id, {}, ip);
      return redirect(request, '/admin/pegawai', 'Status akun pegawai berhasil diperbarui.');
    }
    if (action === 'document-status') {
      if (!isAdmin) return json('Akses ditolak.', 403);
      const id = value(form, 'id');
      const status = value(form, 'status');
      const reason = value(form, 'rejection_reason');
      if (!['diproses', 'selesai', 'ditolak'].includes(status)
        || (status === 'ditolak' && (reason.length < 3 || reason.length > 500))) {
        return redirect(request, '/admin/antrean', 'Status atau alasan penolakan tidak valid.');
      }
      const transitions = { menunggu: ['diproses', 'ditolak'], diproses: ['selesai', 'ditolak'] };
      try {
        await db().begin(async (tx) => {
          const [document] = await tx`SELECT id, user_id, title, status FROM documents WHERE id = ${id} FOR UPDATE`;
          if (!document || !transitions[document.status]?.includes(status)) throw new Error('INVALID_TRANSITION');
          await tx`UPDATE documents SET status = ${status}, rejection_reason = ${status === 'ditolak' ? reason : null}
            WHERE id = ${document.id}`;
          await tx`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
            VALUES (${user.id}, 'document_status_changed', 'document', ${document.id},
            ${JSON.stringify({ from: document.status, to: status, reason: status === 'ditolak' ? reason : null })}, ${ip})`;
          const label = { diproses: 'sedang diproses', selesai: 'selesai dicetak', ditolak: 'ditolak' }[status];
          const message = status === 'ditolak' ? `Dokumen “${document.title}” ditolak. Alasan: ${reason}` : `Dokumen “${document.title}” ${label}.`;
          await tx`INSERT INTO notifications (user_id, title, message, link)
            VALUES (${document.user_id}, 'Status dokumen diperbarui', ${message.slice(0, 500)}, '/dokumen')`;
        });
        return redirect(request, '/admin/antrean', 'Status dokumen berhasil diperbarui.');
      } catch (error) {
        if (error.message === 'INVALID_TRANSITION') return redirect(request, '/admin/antrean', 'Perubahan status tidak tersedia untuk dokumen tersebut.');
        throw error;
      }
    }
    if (action === 'document-delete') {
      if (!isAdmin) return json('Akses ditolak.', 403);
      const id = value(form, 'id');
      const [document] = await db()`SELECT id, title, stored_filename FROM documents WHERE id = ${id}`;
      if (!document) return redirect(request, '/dokumen', 'Dokumen tidak ditemukan.');
      await db().begin(async (tx) => {
        await tx`DELETE FROM documents WHERE id = ${id}`;
        await tx`INSERT INTO audit_logs (user_id, action, entity_type, entity_id, details, ip_address)
          VALUES (${user.id}, 'document_deleted', 'document', ${id}, ${JSON.stringify({ title: document.title })}, ${ip})`;
      });
      if (filenameAllowed(document.stored_filename, 'pdf')) await deletePrivateObject(documentPath(document.stored_filename));
      return redirect(request, '/dokumen', 'Dokumen dan file terkait berhasil dihapus.');
    }
    return json('Aksi tidak dikenali.', 404);
  }

  const email = value(form, 'email').toLowerCase();
  const password = rawValue(form, 'password');
  const limit = await db().begin(async (tx) => {
    const hash = ipHash(ip);
    await tx`INSERT INTO login_rate_limits (ip_hash, window_started_at, attempts)
      VALUES (${hash}, CURRENT_TIMESTAMP, 1)
      ON DUPLICATE KEY UPDATE
        attempts = IF(window_started_at <= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE,
          1, LEAST(attempts + 1, 11)),
        window_started_at = IF(window_started_at <= CURRENT_TIMESTAMP - INTERVAL 15 MINUTE,
          CURRENT_TIMESTAMP, window_started_at)`;
    const [row] = await tx`SELECT attempts FROM login_rate_limits WHERE ip_hash = ${hash} FOR UPDATE`;
    return row;
  });
  if (Number(limit.attempts) > 10) return redirect(request, '/login', 'Terlalu banyak percobaan masuk. Coba kembali beberapa menit lagi.');
  const [user] = await db()`SELECT id, name, email, password_hash, role, is_active, auth_version
    FROM users WHERE LOWER(email) = ${email} LIMIT 1`;
  const dummyHash = '$2b$12$B6wP4wpJcA3FW1ld7swCCO4o8.g6YBPN4ibZcA5beNJAvC9rYgrwa';
  const matches = await bcrypt.compare(password, user?.password_hash || dummyHash);
  if (!user || !matches || !user.is_active) return redirect(request, '/login', 'Email atau kata sandi tidak sesuai.');
  await audit(user.id, 'login', 'session', null, {}, ip);
  await startSession(user);
  return redirect(request, '/');
}

export async function POST(request) {
  try {
    return await postForm(request);
  } catch (error) {
    console.error('SIPRINT action failed:', error.message);
    return json('Permintaan belum dapat diproses. Periksa konfigurasi dan coba lagi.', 500);
  }
}

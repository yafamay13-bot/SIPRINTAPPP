'use client';

import { upload } from '@vercel/blob/client';
import { useState } from 'react';

export default function DocumentUpload({ csrf }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  async function submit(event) {
    event.preventDefault();
    if (busy) return;
    const form = event.currentTarget;
    const file = form.elements.document.files[0];
    if (!file) {
      setMessage('Pilih file PDF.');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      setMessage('Ukuran file maksimal 15 MB.');
      return;
    }
    if (!file.name.toLowerCase().endsWith('.pdf')) {
      setMessage('Pilih file PDF.');
      return;
    }
    setBusy(true);
    setMessage('Mengunggah dokumen dengan koneksi privat…');
    try {
      const prepare = new FormData();
      prepare.set('_csrf', csrf);
      prepare.set('action', 'prepare-document-upload');
      const prepared = await fetch('/api/action', { method: 'POST', body: prepare });
      const signed = await prepared.json();
      if (!prepared.ok) throw new Error(signed.error || 'Tidak dapat memulai unggahan.');
      const uploaded = await upload(`documents/${signed.filename}`, file, {
        access: 'private',
        handleUploadUrl: '/api/blob/upload',
        clientPayload: csrf,
      });
      if (uploaded.pathname !== `documents/${signed.filename}`) throw new Error('Nama file unggahan tidak sesuai.');
      const complete = new FormData();
      complete.set('action', 'complete-document-upload');
      complete.set('_csrf', csrf);
      complete.set('title', form.elements.title.value);
      complete.set('copies', form.elements.copies.value);
      complete.set('notes', form.elements.notes.value);
      complete.set('stored_filename', signed.filename);
      complete.set('original_filename', file.name);
      const result = await fetch('/api/action', { method: 'POST', body: complete, redirect: 'manual' });
      if (result.type === 'opaqueredirect' || result.status === 303) {
        window.location.assign('/dokumen?notice=' + encodeURIComponent('Dokumen berhasil dikirim dan masuk ke antrean admin.'));
        return;
      }
      const body = await result.json().catch(() => ({}));
      throw new Error(body.error || 'Dokumen belum dapat disimpan.');
    } catch (error) {
      setMessage(error.message || 'Unggahan gagal. Silakan coba kembali.');
      setBusy(false);
    }
  }

  return (
    <form className="form-stack" onSubmit={submit}>
      <input type="hidden" name="_csrf" value={csrf} />
      <label htmlFor="title">Nama dokumen <span className="required-mark">*</span></label>
      <input className="form-control" id="title" name="title" type="text" minLength="2" maxLength="160" required />
      <div className="form-grid">
        <div className="form-stack"><label htmlFor="copies">Jumlah salinan</label>
          <div className="number-control"><button type="button" data-number-step="-1" aria-label="Kurangi salinan">−</button><input id="copies" name="copies" type="number" min="1" max="500" defaultValue="1" required /><button type="button" data-number-step="1" aria-label="Tambah salinan">+</button></div>
          <span className="field-help">Jumlah salinan antara 1–500.</span>
        </div>
        <div className="form-stack"><label htmlFor="notes">Keterangan</label>
          <input className="form-control" id="notes" name="notes" type="text" maxLength="1000" />
        </div>
      </div>
      <label>File dokumen <span className="required-mark">*</span></label>
      <label className="drop-zone" htmlFor="document"><span className="upload-symbol">↑</span><strong>Tarik file ke sini atau <span>pilih file</span></strong><small>Dokumen PDF · Maksimal 15 MB</small><span className="selected-file" data-file-name>Belum ada file dipilih</span><input id="document" name="document" type="file" accept=".pdf,application/pdf" required /></label>
      <span className="field-help">File disimpan privat dan diperiksa ulang di server.</span>
      {message && <p role="status" className={busy ? 'field-help' : 'alert alert-error'}>{message}</p>}
      <button className="button button-primary" type="submit" disabled={busy}>{busy ? 'Mengirim…' : 'Kirim ke antrean →'}</button>
    </form>
  );
}

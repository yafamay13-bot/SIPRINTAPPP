# SIPRINT Kabupaten Cirebon

SIPRINT adalah aplikasi internal pengiriman dan pencetakan dokumen. Aplikasi Next.js dan aplikasi PHP lokal menggunakan **MySQL/MariaDB di XAMPP** untuk akun, dokumen, notifikasi, pembatasan login, dan audit. Next.js tetap menggunakan Vercel Blob untuk file privat; aplikasi PHP menyimpan file di `storage/`.

## Fitur

- Login dengan kompatibilitas hash bcrypt PHP, sesi aman, otorisasi peran admin/pegawai, dan pembatasan percobaan login.
- Dashboard, unggah PDF 15 MB, pratinjau/cetak/unduh dokumen privat, antrean/status, dan penghapusan admin.
- Profil, perubahan kata sandi, foto profil, notifikasi, manajemen pegawai, dan audit log.
- Pemeriksaan CSRF, origin, input, dan tanda tangan PDF/gambar.

## 1. Siapkan XAMPP dan database

1. Jalankan **MySQL** dari XAMPP Control Panel. Aktifkan ekstensi PHP `pdo_mysql` untuk Apache dan PHP CLI.
2. `schema.sql` membuat dan memilih database bernama `siprint` secara otomatis. Buka tab **Import** di phpMyAdmin tanpa perlu memilih database terlebih dahulu, lalu impor [`schema.sql`](./schema.sql). Untuk instalasi baru yang kosong, jalankan skema sekali saja. Untuk database yang telah berisi data, **jangan jalankan ulang skema**; buat backup dan tinjau migrasi di `migrations/` terlebih dahulu.

Skema tidak memakai klausa `CHECK` agar tetap dapat diimpor oleh versi MySQL/MariaDB lama yang disertakan dengan XAMPP. Validasi nilai tetap dilakukan oleh aplikasi.

Konfigurasi lokal bawaan mengikuti XAMPP: host `127.0.0.1`, port `3306`, pengguna `root`, tanpa kata sandi. Sesuaikan jika pengaturan XAMPP Anda berbeda. Jika mengganti nama database, ubah juga `USE siprint;` di `schema.sql` agar sama dengan `DB_NAME`.

## 2. Konfigurasi aplikasi

Salin `.env.example` menjadi `.env`, lalu atur:

| Variabel | Kegunaan |
| --- | --- |
| `DB_HOST`, `DB_PORT` | Host dan port MySQL XAMPP |
| `DB_NAME` | Nama database, bawaan `siprint` |
| `DB_USER`, `DB_PASSWORD` | Pengguna MySQL XAMPP |
| `SESSION_SECRET` | Rahasia acak minimal 32 karakter; gunakan nilai berbeda untuk tiap environment |
| `APP_URL` | Origin Next.js lokal, biasanya `http://localhost:3000` |
| `BLOB_READ_WRITE_TOKEN` | Opsional untuk Next.js; diperlukan jika memakai penyimpanan Vercel Blob |

PHP lokal membaca `.env` untuk `DB_*` dan `SESSION_SECRET` melalui `config.php`. File `.env` dan `config.php` tidak boleh dimasukkan ke Git.

Buat `SESSION_SECRET` acak secara lokal:

```powershell
node -e "console.log(require('node:crypto').randomBytes(48).toString('base64url'))"
```

## 3. Jalankan aplikasi

Next.js memerlukan Node.js 20.9 atau lebih baru:

```powershell
npm install
npm run dev
```

Buka `http://localhost:3000`. Jika menggunakan aplikasi PHP, letakkan proyek di bawah `C:\xampp\htdocs` dan buka folder proyek melalui Apache. PHP memakai database MySQL yang sama, tetapi menyimpan unggahan di `storage/`.

## 4. Buat admin pertama

Jalankan sekali dari PowerShell. Script membaca koneksi database dari `.env` dan menolak membuat admin kedua:

```powershell
$env:ADMIN_NAME = "Administrator SIPRINT"
$env:ADMIN_EMAIL = "admin@example.go.id"
$env:ADMIN_PASSWORD = "kata-sandi-acak-minimal-16-karakter"
node --env-file=.env .\scripts\create-admin.mjs
Remove-Item Env:ADMIN_NAME, Env:ADMIN_EMAIL, Env:ADMIN_PASSWORD
```

Berikan password awal melalui kanal privat. Selanjutnya akun pegawai dibuat dari menu admin.

## 5. Uji sebelum digunakan

```powershell
npm test
npm run build
```

Uji login, peran admin/pegawai, unggah dan akses dokumen, perubahan status, profil/password/foto, notifikasi, serta audit log. Pastikan database dan MySQL XAMPP aktif sebelum menguji alur yang memerlukan data.

## Catatan operasional

- Jangan memakai database `root` tanpa kata sandi di jaringan publik. Untuk selain development lokal, buat pengguna MySQL khusus dengan hak akses minimum.
- `schema.sql` mendefinisikan tabel MySQL/InnoDB dan indeks untuk instalasi baru. File migrasi ditujukan untuk perubahan aditif pada database lama; jalankan satu kali setelah backup.
- Penyimpanan file Next.js tetap menggunakan Vercel Blob privat. Untuk pengembangan lokal, atur `BLOB_READ_WRITE_TOKEN`; file PHP tetap disimpan lokal.
- `migrate-mysql-to-supabase.php` adalah utilitas migrasi lama ke PostgreSQL dan bukan bagian dari runtime MySQL.

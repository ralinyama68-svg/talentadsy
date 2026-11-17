# Ruang Talent Adsy — Vercel + Supabase

Web penempatan tim magang dengan 38 soal: 12 minat, 12 situasi kerja, 6 pemahaman dasar, dan 8 pemahaman AI. Peserta hanya mendapat konfirmasi selesai. Hasil peran, nilai AI, jawaban lengkap, catatan, dan ekspor CSV hanya untuk supervisor.

**Paket ini menggantikan paket Sites/Cloudflare sebelumnya.** Kode memakai Vercel Node.js Functions, Supabase Postgres, dan Supabase Auth; tidak membutuhkan Cloudflare, R2, atau login ChatGPT. Tampilan responsif dan logo Adsy sudah termasuk. Tidak memakai framework frontend atau dependensi npm tambahan.

## 1. Siapkan Supabase

1. Buat project di https://supabase.com/dashboard.
2. Buka **SQL Editor**, salin seluruh `supabase/setup.sql`, lalu **Run**. Ini membuat tabel, RLS, dan pembatas percobaan. Jangan menambahkan policy untuk memberi peserta akses hasil.
3. Buka **Authentication > Users > Add user > Create new user**. Buat satu akun email/password SPV milikmu. Tandai email confirmed/auto confirm bila tersedia. Gunakan password kuat. Jangan masukkan password ke GitHub atau chat.
4. Di **Authentication > Sign In / Providers**, pastikan login email/password aktif. Matikan pendaftaran pengguna baru karena peserta tidak membutuhkan akun. Pendaftaran yang terbuka pun tidak memberi akses SPV: server tetap memeriksa email SPV.
5. Ambil **Project URL** dan API keys dari pengaturan API/Data API project. `SUPABASE_ANON_KEY` menerima key anon atau publishable. `SUPABASE_SERVICE_ROLE_KEY` menerima key service_role (legacy JWT) atau secret key `sb_secret_...`. Kunci service_role/secret hanya disimpan di Vercel, tidak dibagikan kepada peserta.

## 2. Upload kode ke GitHub

1. Ekstrak ZIP.
2. Buat repository GitHub **Private**.
3. Upload **isi folder `ruang-talent-adsy-vercel`**, bukan ZIP atau folder pembungkusnya. `package.json`, `vercel.json`, `api/`, `lib/`, `public/`, `scripts/`, `supabase/`, dan `tests/` harus ada di root repository.
4. Jangan upload `.env.local`. File `.env.example` hanya berisi placeholder, aman untuk template.

## 3. Deploy di Vercel

1. Buka https://vercel.com/new dan import repository tadi.
2. Framework preset: **Other**. Node.js: **22.x**. Root directory: folder yang berisi `package.json` (biasanya biarkan root).
3. Build command: `npm run build`. Output directory: `public`. Konfigurasi ini sudah tercantum di `vercel.json`.
4. Tambahkan empat environment variables berikut untuk Production (dan Preview jika ingin mencoba preview):

| Nama | Isi |
| --- | --- |
| `SUPABASE_URL` | Project URL, misalnya `https://abc.supabase.co` |
| `SUPABASE_ANON_KEY` | Anon key atau publishable key project |
| `SUPABASE_SERVICE_ROLE_KEY` | Service-role JWT atau secret key project; rahasiakan |
| `SPV_EMAIL` | Email persis akun SPV yang dibuat di Supabase Auth |

5. Klik Deploy. Jika environment variables diubah setelah deploy, lakukan Redeploy.
6. Buka URL Vercel. Peserta memakai `/tes`; supervisor memakai `/spv`, lalu login dengan email/password Supabase Auth yang dibuat pada langkah pertama.

**Password SPV dari versi Sites lama tidak berlaku pada versi ini.** Gunakan akun Supabase Auth milikmu. Tidak ada password bawaan atau akun SPV otomatis.

## 4. Cek sebelum membagikan ke tim

- `/api/questions` memuat 38 pertanyaan tanpa kunci/bobot jawaban.
- `/api/results` tanpa login menghasilkan 401. Akun lain tidak boleh membaca hasil.
- Kirim satu pengisian percobaan lengkap. Pastikan peserta hanya melihat konfirmasi tersimpan.
- Login SPV: periksa hasil enam peran, nilai AI /8, semua jawaban, catatan yang tetap tersimpan setelah refresh, dan CSV.
- Logout; hasil kembali memerlukan login. Coba tampilan HP.
- URL produksi Vercel dapat dibuka peserta tanpa akun, selama deployment protection Vercel tidak diaktifkan untuk publik. Preview Vercel mungkin dilindungi sesuai pengaturan akunmu.

Jika muncul “Database belum siap”, periksa SQL setup dan key service_role. Jika login gagal, periksa akun confirmed, email `SPV_EMAIL`, project key, dan email/password yang dipakai.

## Jalankan lokal

Butuh Node.js 22. Salin `.env.example` menjadi `.env.local`, isi nilai Supabase milikmu, lalu:

```sh
npm test
npm run build
npm run dev
```

Buka http://localhost:3000. Pengiriman pada lokal tetap memakai database Supabase yang diisi di `.env.local`; gunakan project percobaan bila perlu. Tanpa environment variables, beranda dan soal tetap tampil, tetapi pengiriman/login menolak dengan pesan konfigurasi. Tidak ada mode yang pura-pura menyimpan data.

## Struktur dan keamanan

- `public/`: HTML dan JS browser, sudah disiapkan agar upload via GitHub UI mudah. Build memperbaruinya dari `lib/page.js` dan `lib/client.js`.
- `api/index.js`: Vercel Node.js Function. `vercel.json` mengarahkan `/api/*` ke fungsi ini.
- `lib/api.js`: validasi, login Supabase, pembatasan percobaan, dan akses database.
- `lib/questions.js`: kunci dan skor server-side; tidak diekspor ke browser.
- `supabase/setup.sql`: tabel dan RLS. Semua akses langsung role anon/authenticated ditolak; akses server memakai service-role. Server wajib memeriksa sesi dan email SPV untuk operasi hasil/catatan.
- Token sesi memakai cookie HttpOnly, Secure pada HTTPS, SameSite=Lax. POST memeriksa Origin. Token diverifikasi ke Supabase Auth. Refresh token maksimal 7 hari pada cookie; token yang dicabut ditolak Supabase.
- Pembatas login 15/IP/jam dan pengiriman 100/IP/jam memakai fungsi Postgres atomik; IP di-hash dengan HMAC sebelum disimpan. Jangan mematikan pemeriksaan ini saat produksi.
- UUID pengiriman idempoten; retry tidak menimpa hasil/catatan. Tidak ada API publik yang mengembalikan skor peserta.
- Dashboard memuat 100 peserta per halaman. Statistik/CSV mengikuti data yang sudah dimuat; CSV mengikuti filter. Pilih “Muat peserta berikutnya” untuk memuat lebih banyak.

## Makna skor

Minat: 1 poin per pilihan; situasi kerja: 2 poin; satu soal dasar per peran: 3 poin bila benar. Maksimum teoretis 39 per peran, peluang poin sama. Skor AI terpisah /8 dan tidak mengubah rekomendasi peran. Asesmen internal ini belum tervalidasi secara psikometri. Konfirmasi rekomendasi lewat praktik dan diskusi; skor bukan probabilitas kecocokan.

## Data versi lama

Data dari Sites/Cloudflare tidak otomatis dipindahkan. ZIP ini tidak memuat data peserta atau kredensial produksi. Situs lama tetap terpisah. Bila sebelumnya sudah ada pengisian sungguhan, ekspor dan rencanakan pemindahan datanya sebelum berhenti memakai situs lama.

## Status verifikasi paket

Build dan pengujian otomatis mencakup skor, penolakan akses anonim, otorisasi email, sesi/refresh, pengiriman idempoten, dan catatan melalui mock API Supabase. Koneksi Supabase/Vercel sungguhan dan SQL pada project milikmu belum diuji sampai environment variables dan project tersedia. Paket ini siap dikonfigurasi dan di-deploy, bukan klaim sudah live di akun Vercelmu.

# Deploy ke Railway

Semua konfigurasi sudah ada di repo. `railway.json` memilih `Dockerfile`, health check `/api/health`, 1 replica, dan App Sleeping dimatikan. Kamu cukup mengikuti langkah di bawah.

> Aplikasi ini **satu proses yang harus hidup terus** (pengambil data berjalan di dalamnya). Jangan tambah replica, jangan nyalakan App Sleeping, dan wajib pasang **Volume di `/data`** supaya data tidak hilang saat redeploy.

---

## 0. Yang perlu kamu punya

- Akun **GitHub** dan akun **Railway** (login ke Railway pakai GitHub paling mudah).
- Opsional: video kamu sendiri di `public/videos/hero.mp4` (MP4 H.264, 16:9, di bawah ~10 MB). Commit juga file ini.

## 1. Push kode ke GitHub

Repo ini sudah tersambung ke GitHub (`origin` → `github.com/wutheringweather/Wassily-feed`). Cukup kirim commit terbaru:

```bash
git push origin main
```

Kalau ingin memakai repo lain, buat repository kosong di GitHub, lalu jalankan:

```bash
git remote set-url origin https://github.com/USERNAME/NAMA-REPO.git
git push -u origin main
```

## 2. Buat project di Railway

1. Buka Railway → **New Project** → **Deploy from GitHub repo** → pilih repo tadi.
2. Railway membaca `railway.json` dan membangun dari `Dockerfile`. Deploy pertama akan mulai otomatis.
   Kalau belum sempat mengatur variabel dan volume, tidak masalah: lanjutkan langkah 3–5, lalu **Redeploy**.

## 3. Pasang Volume (wajib)

Buka service → **Settings**, atau klik kanan canvas → **Volume** → buat volume dengan **Mount path: `/data`**.

Tanpa volume, semua token yang sudah dikumpulkan hilang setiap kali deploy ulang.

## 4. Isi Variables

Buka service → tab **Variables** → **Raw Editor**, lalu paste dan sesuaikan:

```env
# Wajib
PORT=3000
DATA_SOURCE=dexscreener
DATA_DIR=/data

# Brand (tampil di situs). Kosongkan kalau belum ada.
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_GITHUB_URL=
NEXT_PUBLIC_X_URL=

# Persona dan rumus awal
NEXT_PUBLIC_DEFAULT_PERSONA=hoeffding
NEXT_PUBLIC_DEFAULT_BOUND=
PERSONA=hoeffding

# Video hero (default sudah benar kalau file ada di public/videos/hero.mp4)
NEXT_PUBLIC_HERO_VIDEO=/videos/hero.mp4

# Opsional: endpoint explorer ber-API-key untuk jumlah holder asli.
# "{address}" diganti otomatis. Kosong = holder diisi nilai tengah.
HOLDERS_API_URL=
```

Catatan:
- Variabel `NEXT_PUBLIC_*` ditanam saat **build**. Setelah mengubahnya, klik **Redeploy**.
- `HOLDERS_API_URL` hanya dibaca server dan tidak pernah dikirim ke browser, jadi aman berisi API key.

## 5. Buat domain publik

Service → **Settings** → **Networking** → **Generate Domain**. Kalau diminta port, isi **3000**.

Kamu juga bisa memakai domain sendiri di bagian yang sama (**Custom Domain**) dan mengikuti instruksi DNS dari Railway.

## 6. Cek hasilnya

1. Buka `https://DOMAIN-KAMU/api/health`. Harus ada `"ok": true` dan `"source": "dexscreener"`.
2. Buka `https://DOMAIN-KAMU`:
   - badge **Live Wassily feed**, dan sidebar tertulis **Live data**;
   - dalam 1–2 menit token asli muncul di feed dengan status **watching**;
   - jar menampilkan **Warming up** dengan hitung mundur ke label pertama.
3. Tab **Deployments** → **View logs** harus menampilkan baris `[agent] LIVE robinhood via DexScreener`.

**Yang perlu diingat:** volume produksi mulai kosong (data lokal di `data/` tidak ikut ter-upload). Label asli pertama muncul **48 jam setelah deploy**, dan jar baru bermakna setelah sekitar 2.000 token berlabel. Perkiraannya 2–3 minggu, tergantung aktivitas chain.

---

## Update berikutnya

Cukup `git push`. Railway membangun ulang otomatis, dan data tetap aman di volume `/data`. Sebelum berhenti, aplikasi menyimpan data saat menerima sinyal stop.

## Kalau ada masalah

| Gejala | Penyebab / solusi |
|---|---|
| Build gagal di `npm ci` | `package-lock.json` tidak sinkron. Jalankan `npm install` di lokal, commit lockfile, lalu push lagi. |
| Build gagal di `tsc --noEmit` | Ada error TypeScript. Jalankan `npm run build` di lokal untuk melihat pesannya. |
| Health check gagal | Buka logs. Pastikan `PORT=3000` sama dengan port domain. |
| Badge tertulis **Simulated** | `DATA_SOURCE` belum `dexscreener`. Perbaiki variabelnya, lalu Redeploy. |
| Data kembali kosong setelah deploy | Volume belum terpasang di `/data`, atau `DATA_DIR` bukan `/data`. |
| Data berhenti bertambah | Pastikan App Sleeping mati dan replica = 1 (sudah diatur di `railway.json`). |
| Brand/video belum berubah | Variabel `NEXT_PUBLIC_*` butuh **Redeploy** karena ditanam saat build. |

## Alternatif: Railway CLI (tanpa GitHub)

```bash
npm i -g @railway/cli
railway login
railway init        # buat project baru
railway up          # upload folder ini dan deploy
```

Volume, Variables dan domain tetap diatur lewat dashboard (langkah 3–5).

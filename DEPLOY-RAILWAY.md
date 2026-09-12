# Deploy ke Railway

Semua konfigurasi sudah ada di repo. `railway.json` memilih `Dockerfile`, health check `/api/health`, 1 replica, dan App Sleeping dimatikan. Kamu cukup mengikuti langkah di bawah.

> Aplikasi ini **satu proses yang harus hidup terus** (pembaca data chain berjalan di dalamnya). Jangan tambah replica, jangan nyalakan App Sleeping, dan wajib pasang **Volume di `/data`** supaya data dan progres backfill tidak hilang saat redeploy.

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

Tanpa volume, semua token berlabel dan progres backfill hilang setiap kali deploy ulang.

## 4. Isi Variables

Buka service → tab **Variables** → **Raw Editor**, lalu paste dan sesuaikan:

```env
# Wajib
PORT=3000
DATA_SOURCE=chain
DATA_DIR=/data

# Brand (tampil di situs). Kosongkan kalau belum ada.
NEXT_PUBLIC_CONTRACT_ADDRESS=
NEXT_PUBLIC_GITHUB_URL=
NEXT_PUBLIC_X_URL=

# Persona dan rumus
NEXT_PUBLIC_DEFAULT_PERSONA=hoeffding
PERSONA=hoeffding

# Opsional: riwayat yang dilabeli saat pertama jalan
BACKFILL_DAYS=14
BACKFILL_SAMPLE=0.5
```

Catatan:
- `DATA_SOURCE=dexscreener` (nama lama) masih diterima dan artinya sama dengan `chain`.
- Variabel `NEXT_PUBLIC_*` ditanam saat **build**. Setelah mengubahnya, klik **Redeploy**.
- `BACKFILL_SAMPLE` = porsi token lama yang dicek, dipilih acak (0.5 = 50%). Token Pons dihitung langsung dari transaksi di chain sehingga cepat; token dari DEX lain lewat GeckoTerminal gratis yang lambat.

## 5. Buat domain publik

Service → **Settings** → **Networking** → **Generate Domain**. Kalau diminta port, isi **3000**.

Kamu juga bisa memakai domain sendiri di bagian yang sama (**Custom Domain**) dan mengikuti instruksi DNS dari Railway.

## 6. Cek hasilnya

1. Buka `https://DOMAIN-KAMU/api/health`. Harus ada `"ok": true` dan `"source": "chain"`. Bagian `ingest` menunjukkan jumlah peluncuran yang terbaca, token yang dicek, dan yang berlabel.
2. Buka `https://DOMAIN-KAMU`:
   - badge **Live Wassily feed**, dan sidebar tertulis **Live data**;
   - kartu jar menampilkan **Labelling past launches … %** selama backfill berjalan;
   - angka **Above $10K** dan **Reached $30K** mulai naik dalam hitungan menit.
3. Tab **Deployments** → **View logs** harus menampilkan baris `[agent] LIVE robinhood from https://rpc.mainnet.chain.robinhood.com` dan `chain: labelling launches from block …`.

**Yang perlu diingat:** saat pertama jalan, aplikasi melabeli riwayat 14 hari terakhir (sampel acak 50%) dari yang terbaru. Token Pons (mayoritas peluncuran) dihitung dari transaksi di chain dan terisi dalam hitungan jam; token DEX lain menyusul mengikuti batas GeckoTerminal. Setelah itu setiap peluncuran baru dicek semua, tepat 48 jam setelah launch.

---

## Update berikutnya

Cukup `git push`. Railway membangun ulang otomatis. Data, token berlabel, dan posisi backfill tetap aman di volume `/data`, jadi backfill melanjutkan dari posisi terakhir.

## Kalau ada masalah

| Gejala | Penyebab / solusi |
|---|---|
| Build gagal di `npm ci` | `package-lock.json` tidak sinkron. Jalankan `npm install` di lokal, commit lockfile, lalu push lagi. |
| Build gagal di `tsc --noEmit` | Ada error TypeScript. Jalankan `npm run build` di lokal untuk melihat pesannya. |
| Health check gagal | Buka logs. Pastikan `PORT=3000` sama dengan port domain. |
| Badge tertulis **Simulated** | `DATA_SOURCE` belum `chain` (atau `dexscreener`). Perbaiki variabelnya, lalu Redeploy. |
| Data kembali kosong setelah deploy | Volume belum terpasang di `/data`, atau `DATA_DIR` bukan `/data`. |
| Backfill terasa lambat | Normal: GeckoTerminal gratis dibatasi ±28 panggilan/menit. Turunkan `BACKFILL_SAMPLE` untuk lebih cepat, atau naikkan untuk lebih lengkap. |
| Log sering menulis `HTTP 429` | RPC atau GeckoTerminal sedang membatasi. Aplikasi menunggu lalu mencoba lagi sendiri; tidak ada data yang salah label. |
| Brand/video belum berubah | Variabel `NEXT_PUBLIC_*` butuh **Redeploy** karena ditanam saat build. |

## Alternatif: Railway CLI (tanpa GitHub)

```bash
npm i -g @railway/cli
railway login
railway init        # buat project baru
railway up          # upload folder ini dan deploy
```

Volume, Variables dan domain tetap diatur lewat dashboard (langkah 3–5).

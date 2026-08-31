# Steading

**Fast. Seamless. 100% Local.**

Pengunduh video dan audio dari **25 situs** — YouTube, TikTok, Instagram, Facebook,
Twitch, Vimeo, Reddit, Bluesky, Bilibili, SoundCloud dan seterusnya — yang berjalan
sepenuhnya di perangkat Anda sendiri. Tidak ada server internet, tidak ada akun, tidak
ada data yang keluar dari perangkat. Frontend-nya PWA — bisa dipasang ke home screen
seperti aplikasi biasa.

Nol dependensi npm. Tanpa build step. `git clone`, pasang yt-dlp, jalankan.

Antarmukanya punya **tema terang dan gelap** (mengikuti sistem, bisa ditimpa manual)
dan tersedia dalam **24 bahasa**, dengan Indonesia dan Inggris sebagai bahasa utama.

## Pasang di HP (Termux)

1. Pasang **Termux** dari [F-Droid](https://f-droid.org/packages/com.termux/)
   (versi Play Store sudah tidak diperbarui).
2. Di Termux:

```bash
pkg install -y git
git clone <repo-anda> steading && cd steading
bash scripts/setup-termux.sh
```

3. Jalankan server:

```bash
npm start
```

4. Buka **Chrome di HP yang sama** ke `http://localhost:3000`.
5. Menu Chrome → **Add to Home screen**. Selesai — sekarang ada ikon Steading di
   layar utama.

Agar Android tidak mematikan Termux di latar belakang, jalankan sekali:

```bash
termux-wake-lock
```

## Pasang di macOS atau Linux

```bash
bash scripts/setup-unix.sh
```

Skrip itu mengenali Homebrew, apt, dnf, dan pacman lalu memasang `yt-dlp` dan `ffmpeg`
kalau belum ada. Tidak ada yang ditambahkan ke PATH dan tidak ada layanan yang dipasang —
Steading hanya hidup selama `npm start` berjalan.

## Pasang di PC

**Windows**

```bash
powershell -ExecutionPolicy Bypass -File scripts\setup-windows.ps1
```

**macOS / Linux**

```bash
brew install yt-dlp ffmpeg
```

Atau di Debian/Ubuntu: `pipx install yt-dlp && sudo apt install ffmpeg`.

Lalu:

```bash
npm run check
npm start
```

Buka `http://localhost:3000`.

> Alternatif tanpa memasang apa pun secara global: letakkan `yt-dlp` (atau
> `yt-dlp.exe`) di folder `bin/`. Steading memeriksa folder itu lebih dulu sebelum
> PATH.

## Cara pakai

1. Tempel tautan, tekan **Cek tautan**.
2. Muncul judul, thumbnail, durasi. Pilih **Video MP4** atau **Audio MP3**, lalu
   kualitas untuk video.
3. Tekan **Unduh**. Progress bar menampilkan persentase, kecepatan, dan sisa waktu
   yang sebenarnya — termasuk tahap penggabungan video/audio.
4. Begitu selesai, berkas langsung tersimpan ke folder Download perangkat, dan salinan
   sementara di server dihapus.

**Bonus:** karena manifest mendaftarkan Steading sebagai share target, Anda bisa
menekan **Bagikan → Steading** langsung dari aplikasi YouTube atau TikTok. Tautannya
otomatis terisi dan langsung diperiksa.

## Membuktikan ke orang lain tanpa memasang apa pun

Kalau seseorang harus memverifikasi aplikasi ini bekerja tapi tidak bisa memasangnya —
penguji, dosen, juri — jalankan:

```bash
npm run share
```

Perintah itu membuka terowongan Cloudflare dan mencetak satu URL publik. Siapa pun yang
membuka URL itu memakai Steading yang sungguhan: unduhan asli, berkas asli, berjalan di
mesin Anda. Butuh `cloudflared` (`winget install Cloudflare.cloudflared` di Windows,
`pkg install cloudflared` di Termux).

Tiga hal yang perlu Anda sadari sebelum memakainya:

- **URL itu publik selama menyala.** Ia pengunduh yang bisa dipakai siapa saja yang
  memegang tautannya, memakai koneksi dan penyimpanan Anda. Tekan Ctrl-C begitu selesai.
- **Alamatnya berganti setiap kali dijalankan.** Terowongan cepat memberi nama acak
  baru, jadi bagikan URL-nya setelah menyalakan, bukan sebelumnya.
- **Hanya hostname itu yang diizinkan.** Proteksi DNS rebinding tetap berlaku; server
  masih menolak Host lain, termasuk yang mencoba menyamar.

Kenapa ini yang dipakai dan bukan hosting biasa: platform besar yang didukung
memblokir alamat IP milik penyedia hosting. Diuji langsung dari Vercel, TikTok
menjawabnya harfiah — "Your IP address is blocked from accessing this post". Dari
koneksi rumah Anda tidak ada masalah itu, dan terowongan membuat koneksi rumah itulah
yang dipakai.

## Format yang bisa disimpan

| Jenis | Pilihan                   | Catatan                                        |
| ----- | ------------------------- | ---------------------------------------------- |
| Video | MP4, MKV, WebM            | kualitas bisa dibatasi 1080p ke bawah          |
| Audio | MP3, M4A, Opus, WAV, FLAC | WAV dan FLAC tanpa kompresi, berkasnya besar   |
| Foto  | JPG, PNG, WebP            | mengambil sampul atau thumbnail, bukan videonya |
| Foto  | PDF                       | semua gambar dalam satu kiriman, jadi satu berkas |

Foto berguna untuk sampul album SoundCloud atau thumbnail YouTube. Kalau tautannya sama
sekali tidak punya gambar, Steading bilang begitu daripada menyimpan berkas kosong.

Situs yang isinya audio saja — SoundCloud, Bandcamp, Mixcloud — tidak menawarkan video.
Tombol Video mati sendiri dan alasannya ditulis, bukan sekadar dimatikan diam-diam.

## Banyak foto jadi satu PDF

Pilih **Foto**, lalu tipe **PDF**. Semua gambar dalam satu kiriman digabung jadi satu
berkas, satu gambar per halaman, ukuran halaman mengikuti ukuran gambarnya — tidak
dipaksa ke A4, jadi foto potret tidak diberi pinggiran kosong.

Gambar dicari lewat tiga penyedia yang dicoba berurutan: gallery-dl kalau kebetulan
terpasang, lalu pembaca HTML bawaan yang menangani situs biasa dan forum, lalu thumbnail
dari yt-dlp. **Tidak satu pun wajib** — yang tidak terpasang dilewati begitu saja.
Urutannya bisa Anda atur:

```bash
IMAGE_PROVIDERS=scrape npm start
```

Halaman yang tidak bisa dibaca yt-dlp — artikel, utas forum — tetap bisa diambil
gambarnya. Localizer akan bilang bahwa tautan itu bukan video atau lagu, lalu mengunci
pilihan ke Foto.

### Slider kualitas

Untuk Foto ada slider lima tingkat: **Sangat ringan → Ringan → Seimbang → Tinggi →
Asli**. Bawaannya Asli, karena menurunkan kualitas gambar yang tidak diminta turun itu
terbalik urutannya — dan menggesernya ke kiri cuma satu gerakan.

Bedanya nyata. Artikel yang sama, enam halaman: **2,37 MB** pada Asli, **433 KB** pada
Ringan. Berguna kalau PDF-nya mau dikirim lewat WhatsApp.

Pada Asli, JPEG yang datang sebagai JPEG ditanam apa adanya — tidak dibongkar, tidak
disandikan ulang, jadi tidak ada kualitas yang hilang.

## Ekstensi browser

Ada di folder `extension/`. Satu tombol di toolbar: halaman yang sedang dibuka dikirim ke
Steading. Klik kanan sebuah tautan juga bisa — itu yang berguna di halaman feed, karena
alamat tab-nya adalah feed, bukan kirimannya.

Ekstensinya **tidak** mengunduh apa pun sendiri; ia cuma membuka
`http://127.0.0.1:3000/?url=…`. Karena itu ia tidak minta izin akses situs mana pun dan
tidak membaca isi halaman. Cara pasangnya ada di `extension/README.md`.

## Situs di luar daftar

Secara bawaan hanya situs yang terdaftar yang diterima, dan itu memang batas keamanannya.
Kalau Anda mau mencoba situs lain:

```bash
UNIVERSAL=1 npm start
```

Semua tautan http/https lalu diteruskan ke yt-dlp. Yang perlu dipahami: daftar putih itu
yang menjamin sebuah halaman di tab lain tidak bisa menyuruh server lokal Anda menyusuri
seribuan ekstraktor yt-dlp. Pertahanan lain tidak ikut dilonggarkan — tetap tanpa shell,
argumen tetap array, tetap `--` sebelum URL, tetap terikat ke loopback, dan pemeriksaan
Host tetap jalan. Steading juga memberi tahu di layar kalau mode ini sedang aktif.

## Tema dan bahasa

Dua tombol di pojok kanan atas.

**Tema** mengikuti setelan sistem sampai Anda menekannya sekali; setelah itu pilihan
Anda yang menang dan tersimpan. Warnanya berganti dengan transisi 200 ms, dan tema
yang benar sudah terpasang sebelum halaman digambar — tidak ada kedipan putih saat
membuka aplikasi dalam mode gelap.

**Bahasa** terisi otomatis dari bahasa peramban, lalu bisa diganti kapan saja. Bahasa
Indonesia dan Inggris ikut di dalam app shell; 22 bahasa lain diambil sekali saat
dipilih, jadi ukuran shell tetap kecil. Bahasa Arab dan Persia otomatis beralih ke tata
letak kanan-ke-kiri.

| Bahasa yang tersedia |
| -------------------- |
| Indonesia, English, Melayu, العربية, বাংলা, Deutsch, Español, فارسی, Filipino, Français, हिन्दी, Italiano, 日本語, 한국어, Nederlands, Polski, Português, Русский, ไทย, Türkçe, Українська, Tiếng Việt, 简体中文, 繁體中文 |

Server tidak pernah mengirim kalimat siap tampil. Ia mengirim **kode galat** seperti
`private_content`, dan sisi klien yang memilih kata-katanya. Menambah bahasa baru cukup
dengan menaruh satu berkas di `public/i18n/`; kode server tidak perlu disentuh sama
sekali.

## Perintah

| Perintah        | Fungsi                                      |
| --------------- | ------------------------------------------- |
| `npm start`     | menjalankan server di `127.0.0.1:3000`      |
| `npm run share` | sama, plus URL publik sementara lewat terowongan |
| `npm run check` | memeriksa yt-dlp, ffmpeg, dan versi Node    |
| `npm test`      | menjalankan unit test                       |
| `npm run icons` | membuat ulang ikon PWA                      |

Ganti port: `PORT=3001 npm start`.

## Cara kerjanya

```
Browser  ──POST /api/info──▶  yt-dlp -J          (metadata saja, belum mengunduh)
         ──POST /api/jobs──▶  yt-dlp → tmp/<id>/ (unduhan sungguhan dimulai)
         ◀──SSE /events────   progres nyata: persen, kecepatan, ETA, tahap ffmpeg
         ──GET  /file──────▶  berkas di-stream sebagai attachment, lalu tmp/ dihapus
```

Dua fase, bukan satu pipa langsung, karena penggabungan video+audio dan encoding MP3
sama-sama butuh berkas yang bisa di-seek — pipa tidak bisa. Efek sampingnya justru
bagus: ada `Content-Length`, jadi browser HP menampilkan progress unduhan yang benar.

Penjelasan arsitektur lengkap, termasuk kontrak pembersihan berkas sementara, ada di
[CLAUDE.md](CLAUDE.md).

## Keamanan

Steading mengikat diri ke `127.0.0.1` dan tidak pernah membuka diri ke jaringan, tapi
sebuah halaman jahat di tab lain tetap bisa mencoba menghubunginya. Yang menahannya:

- **Daftar putih situs.** yt-dlp hanya menerima host dari tabel di
  `server/lib/validate.js`. Selain itu ditolak sebelum ada proses yang dijalankan —
  menambah situs berarti menambah satu baris di sana, bukan melonggarkan pemeriksaannya.
- **Tanpa shell.** Semua argumen disusun sebagai array di satu berkas (`server/ytdlp.js`)
  dan selalu ditutup `--` sebelum URL, jadi tautan tidak pernah bisa menyamar jadi flag.
- **Cek Host, bukan cuma Origin.** Situs jahat bisa mengarahkan domainnya sendiri ke
  127.0.0.1 (DNS rebinding) sehingga lolos pemeriksaan Origin. Header `Host` tidak bisa
  dipalsukan seperti itu, dan permintaan yang tidak dialamatkan ke nama loopback ditolak.
- **CSP ketat.** Halaman hanya boleh memuat skrip dan gaya dari dirinya sendiri, tidak
  bisa dibingkai, dan tidak punya skrip inline sama sekali.
- **Nama berkas dibersihkan.** Judul datang dari situs luar, jadi ia dibersihkan dari
  pemisah path, karakter terlarang Windows, dan nama perangkat seperti `CON`.
- **Batas ukuran permintaan** 8 KB, dan maksimal dua unduhan berjalan bersamaan.

## Kalau ada masalah

**"yt-dlp belum terpasang"** — jalankan `npm run check`, ikuti perintah pemasangan yang
ditampilkan untuk platform Anda.

**MP3 gagal, atau video tanpa suara** — ffmpeg belum ada. `pkg install ffmpeg` di
Termux, `winget install Gyan.FFmpeg` di Windows.

**"Konten ini privat atau butuh login"** — Steading hanya mengambil konten publik.
Postingan privat memang tidak bisa diunduh.

**Situs berubah dan unduhan mulai gagal** — YouTube dan TikTok rutin mengubah cara
kerja mereka. Perbarui yt-dlp: `pip install -U yt-dlp` (Termux) atau
`yt-dlp -U` (biner mandiri). Ini penyebab paling sering dari error 403.

**Port 3000 dipakai aplikasi lain** — `PORT=3001 npm start`.

## Catatan penggunaan

Unduh hanya konten yang Anda berhak simpan — karya sendiri, materi berlisensi bebas,
atau hal-hal yang diizinkan oleh ketentuan layanan platform terkait. Alat ini berjalan
lokal di perangkat Anda; tanggung jawab atas apa yang diunduh ada pada Anda.

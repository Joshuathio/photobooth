# Photobooth

Aplikasi photobooth berbasis web: ambil 4 foto dengan countdown dan prompt pose, lalu otomatis
dibuat **lembar cetak 4x6"** (2 strip identik), **foto story 9:16**, dan **GIF animasi**.
Hasilnya di-upload ke Cloudinary, dan tamu cukup scan QR code untuk mengambil fotonya di
halaman galeri.

Dibuat dengan **Vite + TypeScript** tanpa framework, jadi ringan dan bisa di-host sebagai
file statis di mana saja.

## Fitur

**Console booth (Mac)** — `index.html`
- Kamera besar untuk cek framing: webcam Mac, iPhone (Continuity Camera), atau DSLR lewat capture card HDMI
- **Mirror layar tablet**: salinan persis layar tamu. Klik di mirror = tap di tablet
- **Pratinjau desain**: tombol Layar awal / Pilih frame / Pilih gaya / Foto / Pilih foto / Menyiapkan / Hasil + QR untuk melihat tiap layar
  dengan data contoh, di Mac dan di tablet sekaligus (klik lagi untuk replay animasi)
- Hasil terakhir: lembar cetak, frame yang dipilih tamu, QR, download ulang sheet
- Status bar: tablet / kamera / cloud, tahap sesi, gaya default, Mulai, Reset
- Pengaturan dan log dalam drawer
- Shortcut keyboard: `Space` mulai, `Esc` reset (atau tutup drawer), `F` layar penuh

**Layar tamu (tablet, landscape)** — `guest.html`
- Layar awal dengan preview kamera live dan daftar frame
- **Pilih frame** (tanpa gacha): 5 frame Dearly "Minimal" (frame 1–5). Tamu tap satu frame lalu "Choose this frame"
- Pilih gaya: Friends, Couple, Uni Life, atau **Bebas** (tanpa arahan pose). Tiap gaya punya 15
  arahan pose; tiap sesi dapat 7 acak + foto terakhir bebas. Pose diambil seperti kartu yang dikocok
  (`src/booth/prompts.ts`), jadi pose yang sama baru muncul lagi setelah semua pose gaya itu terpakai. Daftar pose ada
  di `DECKS` (`src/booth/config.ts`). Tombol "Kembali" balik ke pilih frame
- **8 foto** dengan arahan pose, countdown, dan flash (8 arahan berbeda per gaya)
- **Pilih 4 foto** favorit untuk strip (tap di tablet). Kalau 1 menit tidak selesai, otomatis dipakai foto paling awal
- Hasil (90 detik): strip, frame, QR code ke galeri, kode sesi
- Layar penuh otomatis saat disentuh, layar tidak mati selama dipakai

**Proses foto**
- Lembar cetak 1200×1800 (300dpi). Strip: 2 strip identik berisi 4 foto pilihan, posisi foto sama dengan template
  frame (lubang 520×340 di x40, y43, jarak 37).
  Story 1080×1920, GIF 8 frame 480×320, warna sesuai frame yang dipilih
- Kode sesi 6 karakter tampil di layar tablet, tidak dicetak di strip (tanpa huruf yang mirip seperti 0/O dan 1/I/L)
- **Setiap sesi tersimpan lokal sebagai satu file zip** di folder Downloads Mac, apa pun kondisi sinyal:
  `dearly-KODE.zip` berisi 8 foto satuan (`foto-KODE-1.jpg` … `-8.jpg`), lembar cetak (`sheet-KODE.jpg`), `story-KODE.jpg` dan `anim-KODE.gif`. Kalau pembuatan lembar gagal, zip tetap berisi 8 foto satuan. Lembar cetak berisi 2 bagian identik,
  jadi dicetak dengan setelan potong 2x6; ekstrak zip dulu sebelum mencetak (atau pakai "Download ulang sheet")
- Upload ke Cloudinary berjalan di atasnya (untuk galeri dan QR); kalau upload gagal, file lokal tetap ada

**Galeri (tamu)** — `gallery.html`
- Buka lewat QR (`?s=KODE`) atau ketik kode secara manual
- Preview strip dan GIF, tombol download foto / GIF / lembar cetak, tombol **Bagikan**

## Menjalankan

Butuh Node.js 20+.

```bash
npm install
npm run dev        # console: http://localhost:5173 · tablet: /guest.html · galeri: /gallery.html
```

> Kamera hanya bisa diakses lewat `http://localhost` atau `https://`, tidak bisa dari `file://`.

### Menyambungkan tablet (Galaxy Tab S8) lewat kabel

Sekali saja di tablet:
1. Settings → About tablet → Software information → ketuk **Build number** 7 kali (Developer options aktif).
2. Developer options → nyalakan **USB debugging**.

Sekali saja di Mac: `brew install android-platform-tools` (untuk perintah `adb`).

Setiap kali dipakai:
1. Jalankan `npm run dev` dan buka console di Mac (`http://localhost:5173`).
2. Colok tablet ke Mac pakai kabel USB-C **data** (bukan kabel charge saja), ketuk **Allow** di tablet.
3. Jalankan `npm run tablet` di terminal kedua.
4. Di Chrome tablet buka `http://localhost:5173/guest.html`. Tambahkan ke Home screen supaya selalu layar penuh,
   dan pakai **App pinning** (Settings → Security) supaya tamu tidak bisa keluar.

Kalau kabel dicabut, ulangi langkah 3 (atau pakai `npm run tablet:watch`, lihat di bawah). Cadangan tanpa kabel:
`npm run dev:wifi`, lalu buka `http://IP-MAC:5173/guest.html` di tablet (Mac dan tablet harus di Wi-Fi yang sama,
tanpa client isolation).

### Saat event (paling stabil)

```bash
npm run booth          # build lalu jalankan versi jadi (tidak ada reload otomatis seperti di mode dev)
npm run tablet:watch   # di tab Terminal kedua: memasang ulang sambungan USB tablet kalau kabel sempat lepas
```

- Buka console **di satu tab saja**. Kalau terbuka di dua tab, tablet ikut tab yang paling baru dan tab lama
  menampilkan peringatan merah "Tab ini tidak aktif".
- Biarkan jendela console tetap kelihatan (jangan ditutup jendela lain atau di-minimize) dan matikan sleep Mac.
  Timer sudah tetap jalan di background, tapi kamera bisa tersendat kalau jendelanya tersembunyi.
- Sambungan Mac ↔ tablet punya heartbeat: kalau putus diam-diam, dalam ±10 detik tablet menampilkan
  "Sebentar ya…", menyambung lagi sendiri dan kembali ke layar sesi yang sedang berjalan.

Perintah lain:

```bash
npm run build      # build produksi ke folder dist/
npm run preview    # jalankan hasil build (sambungan tablet juga jalan di sini); `npm run booth` = build + preview
npm test           # unit test
npm run typecheck  # cek TypeScript
```

## Konfigurasi

1. **Cloudinary**: buat akun gratis, lalu buka Settings → Upload → *Add upload preset* dengan
   mode **Unsigned**. Isi *cloud name* dan nama preset di panel Pengaturan booth.
2. **Galeri**: salin `.env.example` menjadi `.env` dan isi `VITE_CLOUDINARY_CLOUD_NAME` dengan
   cloud name yang sama (default: `fbhrxtkn`). Build, lalu host folder `dist/` (misalnya Netlify,
   Vercel, GitHub Pages, atau Cloudflare Pages).
3. Isi **URL halaman galeri** di booth, misalnya `https://domainkamu.com/gallery.html`. QR code
   akan mengarah ke URL itu ditambah kode sesi.

## Struktur

```
index.html, guest.html, gallery.html   console Mac, layar tablet, galeri tamu
server/booth-link.ts         hub WebSocket Mac ↔ tablet (plugin Vite)
src/host/                    console Mac (React): controller.ts + App.tsx
src/guest/                   layar tamu (React): GuestScreen.tsx dipakai tablet dan mirror
src/booth/
  session.ts                 alur sesi: layar awal → frame → gaya → 8 foto → pilih foto → menyiapkan → hasil (diuji)
  gacha.ts                   daftar frame dan roll() berbobot, dipakai kalau suatu hari gacha kembali (diuji)
  preview-stream.ts          kirim preview kamera ke tablet
  camera.ts                  akses kamera (getUserMedia)
  compose.ts                 gambar strip, sheet, story, GIF
  layout.ts                  perhitungan crop/fit (diuji)
  config.ts                  ukuran cetak, timing, deck prompt
  settings.ts                pengaturan yang disimpan di localStorage
src/shared/                  kode sesi, URL Cloudinary, protokol sambungan, state layar tamu
src/ui/                      komponen bersama (stage berskala, video live, QR)
tests/                       unit test (Vitest)
```

## Desain (Dearly)

Warna, font dan elemen dekorasi diambil dari deck Venture Creation dan ada di `src/ui/brand.css`:
background gingham biru (layar awal tablet: gradien biru ke putih dengan titik-titik putih), kertas krem, kartu tan, merah Dearly, huruf "stiker" krem dengan outline merah,
label merah, sticky note kuning, perangko, dan bintang (`src/ui/Decor.tsx`).

Font sudah dibundel lewat npm (tidak perlu internet saat event): **Beth Ellen** (tulisan sambung,
mis. "Dearly") dan **Darumadrop One** (judul, tombol, label) dan **Nunito** (teks panjang seperti paragraf dan petunjuk).
Teks panjang baru tinggal diberi class `long-text`. Untuk ganti font, ubah bagian atas
`brand.css` dan di `FONTS` pada `src/booth/config.ts` (dipakai untuk strip cetak).

## Mengubah daftar frame

Frame ada di `FRAMES` (`src/booth/gacha.ts`) dan semuanya tampil di layar "Pick a frame!" sesuai urutannya.
Tamu memilih sendiri, tidak ada undian. `roll()` dan `weight` masih ada kalau nanti mau mengundi lagi.

## Mengganti desain frame

Frame dari desainer ada di `public/frames/`: PNG 1200×1800 (dua strip identik) dengan lubang foto transparan di
posisi template (y 43 / 420 / 797 / 1174, tinggi 340), plus thumbnail satu strip (`-thumb.jpg`, 200×600) untuk
layar tablet. Untuk menambah frame:

1. Taruh PNG di `public/frames/<nama-folder>/` dan buat thumbnail-nya (strip kiri, lubang diisi warna netral).
2. Di `FRAMES` (`src/booth/gacha.ts`) isi `art: { sheet, thumb }`, warna latar (`bg`), warna tulisan (`ink`) dan
   `outline` kalau tulisannya bergaris tepi (seperti frame gingham).

Foto digambar di bawah PNG; kode sesi tidak dicetak di strip.


## Catatan keamanan

Upload preset *unsigned* dan cloud name terlihat di sisi browser, jadi siapa pun yang tahu
bisa upload ke akun Cloudinary tersebut. Cukup untuk prototype/event; untuk produksi sebaiknya
pakai signed upload lewat backend kecil, dan batasi preset (format, ukuran, folder `booth/`).

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
- **Pratinjau desain**: tombol Layar awal / Pilih set / Pilih gaya / Foto / Gacha / Buku / Hasil + QR untuk melihat tiap layar
  dengan data contoh, di Mac dan di tablet sekaligus (klik lagi untuk replay animasi)
- Hasil terakhir: lembar cetak, frame hasil gacha, QR, download ulang sheet, download file buku (juga kalau tamu beli belakangan)
- Status bar: tablet / kamera / cloud, tahap sesi, gaya default, Mulai, Reset
- Pengaturan dan log dalam drawer
- Shortcut keyboard: `Space` mulai, `Esc` reset (atau tutup drawer), `F` layar penuh

**Layar tamu (tablet, landscape)** — `guest.html`
- Layar awal dengan preview kamera live dan isi tiap set frame
- **Pilih set frame**: Set A (frame 1–5) dan Set B (frame 6–8). Tamu tap satu set lalu "Pakai Set …"
- Pilih gaya: Bestie, Couple, Chaos, Corporate, Anak Kuliahan, atau **Bebas** (tanpa arahan pose). Tiap gaya punya 21–24
  arahan pose; tiap sesi dapat 7 acak + foto terakhir bebas. Pose diambil seperti kartu yang dikocok
  (`src/booth/prompts.ts`), jadi pose yang sama baru muncul lagi setelah semua pose gaya itu terpakai. Daftar pose ada
  di `DECKS` (`src/booth/config.ts`). Tombol "Kembali" balik ke pilih set
- **8 foto** dengan arahan pose, countdown, dan flash (8 arahan berbeda per gaya)
- **Pilih 4 foto** favorit untuk strip (tap di tablet). Kalau 1 menit tidak selesai, otomatis dipakai foto paling awal
- **Upsell versi besar**: tombol "Suka semua?" mencetak semua 8 foto ukuran kecil landscape (3,5 × 2,55 cm), 2 set.
  Tablet menunggu sampai kasir menekan **Sudah bayar, cetak versi besar** di Mac (atau "Batal upgrade"); kalau 1 menit tidak dijawab, permintaan batal dan tamu kembali memilih 4 foto
- **Gacha frame** dengan animasi kapsul, diundi dari frame di set yang dipilih (peluang sama). Set A = 5 frame
  "Minimal" dari desainer (frame 1–5), Set B = 3 frame "Bifest" (BINUS Festival, frame 6–8)
- **Info gantungan kunci buku (+15rb / 2 buku 25rb)** setelah gacha, sebelum QR: layar dengan buku mini berisi foto
  tamu. Tamu yang mau bilang ke kru dan bayar di kasir; layar hanya info, tidak ada tombol beli, tamu menekan
  "Next" ke layar hasil (otomatis lanjut sendiri setelah 1 menit kalau ditinggal). Operator membuat file
  `buku-KODE.jpg` (16 foto landscape, 8 foto × 2) lewat "Download file buku" di panel Hasil terakhir.
- Hasil (90 detik): strip, frame, QR code ke galeri, kode sesi
- Layar penuh otomatis saat disentuh, layar tidak mati selama dipakai

**Proses foto**
- Lembar cetak 1200×1800 (300dpi). Strip: 2 strip identik berisi 4 foto pilihan, posisi foto sama dengan template
  frame (lubang 520×340 di x40, y43, jarak 37). Versi besar: 16 foto landscape 414×300 (3,5 × 2,55 cm), dua bagian identik
  berisi 8 foto (4 kolom × 2 baris) dengan logo di samping; di file cetak isinya diputar 90° supaya potongan 2x6
  printer jatuh di antara dua bagian. Versi digital 8 foto: grid landscape 2×4.
  Story 1080×1920, GIF 8 frame 480×320, warna sesuai frame gacha
- Kode sesi 6 karakter tampil di layar tablet, tidak dicetak di strip (tanpa huruf yang mirip seperti 0/O dan 1/I/L)
- Upload ke Cloudinary; kalau cloud belum diatur atau upload gagal, file di-download lokal
- Lembar cetak selalu di-download ke Mac untuk dicetak (`sheet-KODE.jpg` / `sheet-KODE-besar.jpg`). Keduanya berisi
  2 bagian identik, jadi dicetak dengan setelan potong 2x6 yang sama
- Semua tamu dapat versi digital **8 foto** (`booth/KODE/all.jpg`) di galeri, apa pun paketnya

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
  session.ts                 alur sesi: layar awal → set → gaya → 8 foto → pilih foto → gacha → buku → hasil (diuji)
  gacha.ts                   set frame, daftar frame dan roll() berbobot (diuji)
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

## Mengubah gacha

Set ada di `FRAME_SETS` dan frame di `FRAMES` (`src/booth/gacha.ts`). Tiap frame punya `set: 'A' | 'B'`;
gacha hanya mengundi frame dari set yang dipilih tamu. Nama set ("Set A" dst.) cukup diganti di `label`.
Sekarang semua `weight: 1` (peluang sama). Untuk tier rarity, ubah bobotnya, misalnya 60/30/10; pengaturan di Mac
otomatis menampilkan persentase yang baru.

## Mengganti desain frame

Frame dari desainer ada di `public/frames/`: PNG 1200×1800 (dua strip identik) dengan lubang foto transparan di
posisi template (y 43 / 420 / 797 / 1174, tinggi 340), plus thumbnail satu strip (`-thumb.jpg`, 200×600) untuk
layar tablet. Untuk menambah frame:

1. Taruh PNG di `public/frames/<nama-set>/` dan buat thumbnail-nya (strip kiri, lubang diisi warna netral).
2. Di `FRAMES` (`src/booth/gacha.ts`) isi `art: { sheet, thumb }`, warna latar (`bg`), warna tulisan (`ink`) dan
   `outline` kalau tulisannya bergaris tepi (seperti frame gingham).

Foto digambar di bawah PNG; kode sesi tidak dicetak di strip.
Versi besar/buku dan sheet digital 8 foto memakai warna frame dengan tulisan "with love, Dearly". Frame tanpa
`art` digambar dari warna + pola (`paintFrame` di `src/booth/compose.ts`).

## Catatan keamanan

Upload preset *unsigned* dan cloud name terlihat di sisi browser, jadi siapa pun yang tahu
bisa upload ke akun Cloudinary tersebut. Cukup untuk prototype/event; untuk produksi sebaiknya
pakai signed upload lewat backend kecil, dan batasi preset (format, ukuran, folder `booth/`).

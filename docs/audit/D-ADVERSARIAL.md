# D — Pemeriksaan Bantahan (Adversarial)

**Tanggal:** 28 Okt 2026 · **Pemeriksa:** Reality Checker
**Deadline submit:** 4 Nov 2026, 21:00 EST

Tulisan ini menjawab satu pertanyaan: **apa yang wajib selesai, apa yang boleh ditunda, dan apa yang
harus dihentikan** sebelum 4 November. Nada tegas. Tidak ada angka yang saya karang.

---

## 1. Cutting line sisa waktu

**Hitungan hari kerja (saya hitung sendiri, dari dokumen):**
- Hari ini menurut dokumen proyek: **Rabu 28 Okt 2026**.
- Deadline: **Selasa 4 Nov 2026, 21:00 EST = Rabu 5 Nov 09:00 WIB** (selisih 13 jam Jakarta–New York).
- Hari kerja tersisa: Kam 29, Jum 30, Sab 31, Sen 2, Sel 3 = **5 hari kerja penuh**, plus Rabu 5 Nov
  sampai 09:00 WIB sebagai penyangga tipis. Sabtu 31 Okt saya hitung sebagai hari kerja karena
  deadline, bukan karena disiplin.

**Yang harus saya katakan lebih dulu:** keempat ADR menjadwalkan shell Android (Capacitor) ke Minggu 3
dan Glimmer ke Minggu 5–6. Minggu-minggu itu **tidak ada** dalam kalender 4 November. Rencana 6
minggu itu tidak gagal; rencana itu memang tidak pernah cocok dengan tanggal submit. Jadi cutting
line di bawah bukan pilihan gaya, itu pilihan bertahan.

### WAJIB — maksimal 5, tidak bisa ditawar

| # | Item | Ukuran selesai yang bisa dibuktikan |
|---|---|---|
| W1 | **Repo publik + README jujur** menyatakan apa yang dibuat 27 Okt–4 Nov (syarat G4). Tanpa repo, tidak ada yang dinilai | Tautan bisa dibuka tanpa login |
| W2 | **Video demo ≤ 3 menit** — 25% nilai, dan satu-satunya artefak yang dilihat juri secara utuh | Versi final bisa ditonton tanpa suara, tanpa layar palsu |
| W3 | **Satu alur ujung-ke-ujung benar-benar jalan**: rekam → transkrip → dokumen → PDF → kirim. Satu jenis dokumen saja — **Surat Penawaran** (putusan KEPUTUSAN-ADR.md §5), sesuai keputusan G2 "bila gagal" | Satu rekaman asli jadi satu PDF utuh |
| W4 | **Guard angka ADR-0002 hidup**: setiap angka punya `sumber_kutipan`, yang tidak jelas masuk `butuh_konfirmasi` dan status dokumen ditahan | Uji 10 transkrip cacat sengaja: nol angka karangan |
| W5 | **Antrean IndexedDB (O1)** menyimpan audio saat sinyal putus dan mengirim saat pulih | Uji mode pesawat, tidak ada audio hilang > 1 detik |

### OPSIONAL — maksimal 4, hanya bila W1–W5 sudah hijau

| # | Item | Batas |
|---|---|---|
| O1 | Proxy WSS realtime asli (bukan REST dulu) | Hanya setelah jalur REST file terbukti jalan |
| O2 | Kartu koreksi dengan kutipan giliran asal | Cukup satu layar; tanpa animasi |
| O3 | Template resmi jenis dokumen lain (Laporan Harian, Berita Acara) | Hanya bila PDF Surat Penawaran sudah diterima klien nyata (putusan KEPUTUSAN-ADR.md §5) |
| O4 | Meteran biaya per pengguna | Baca-saja, tanpa dasbor |

### JANGAN DIBANGUN — maksimal 5

| # | Item | Alasan |
|---|---|---|
| J1 | **Kapasitor / shell Android (ADR-0004 bagian D9)** | Butuh 2–3 hari untuk izin mikrofon, rekam latar, lokasi, plus build + tandatangan APK. PWA memberi izin mikrofon tanpa ini |
| J2 | **PDF via Typst (ADR-0003)** | Biner server baru + toolchain + font Indonesia. Menambah satu titik gagal di hari terakhir demi kualitas yang belum terbukti lebih baik |
| J3 | **Muse Glimmer / jalur Best Open Weight (O2)** | Statusnya sendiri sudah "dirancang, belum diuji". Menjalankannya sekarang = memproduksi klaim tanpa bukti |
| J4 | **Sambung ulang sesi 60 menit + jahitan transkrip** | Kasus tepi; tidak muncul di demo 3 menit dan tidak diuji siapa pun minggu ini |
| J5 | **Mode diarization "wawancara klien"** | Memperburuk latensi; berita acara bisa menunggu |

### Akibat nyata bila ADR-0003 (Typst) dan ADR-0004 (Capacitor) tetap dikerjakan sekarang

**ADR-0003 — Typst:** menuntut biner di server plus pipeline build. Yang dikorbankan konkret: **1–2
dari 5 hari kerja tersisa**, diambil dari W3 dan W2. Bila kompilasi gagal karena font atau tata letak
tabel RAB, kegagalan itu muncul **pada hari ke-4–5**, saat tidak ada waktu tersisa. Hasilnya bukan
"PDF kurang rapi" tapi **kegagalan W3 dan W2 sekaligus** — dan tanpa PDF tidak ada video demo, karena
video itu merekam alur ini. Yang lebih bijak: satu perender, jalur yang sudah paling dikenal tim, dan
kualitas cetak diuji belakangan.

**ADR-0004 — Capacitor:** menuntut SDK Android, Gradle, izin mikrofon, rekam latar, lokasi, lalu
build+tandatangan APK. Yang dikorbankan: **2–3 hari kerja**, yaitu hampir seluruh sisa waktu.
Kegagalan khasnya bukan "APK tidak jadi" tapi **APK jadi tapi mikrofon tidak berbunyi di perangkat
kelas bawah** — dan saat itu terdeteksi, tidak ada hari untuk memperbaiki. Tambahan bahaya: penguji
lapangan (Gate 3) jadi bergantung pada tautan unduhan pribadi, bukan satu tautan yang bisa dibuka
siapa saja. PWA sudah memberi izin mikrofon tanpa semua ini.

**Kesimpulan tegas: keempat ADR tidak perlu dihapus, tapi keduanya harus dibekukan hari ini.**
Keduanya berstatus "diputuskan", bukan "dikerjakan minggu ini". Menuliskan tanggalmulai ulang di ADR
cukup; tidak mengerjakannya tidak melanggar keputusan mana pun.

---

## 2. Tiga skenario gagal paling mungkin minggu ini

### S1 — Proxy WebSocket menyala, tapi transkrip tidak pernah datang (paling mungkin)

**Gejala awal, hari itu juga:** klien membuka soket dan **handshake ditolak/ditutup**, atau soket
terbuka tapi hanya mengirim `error` tanpa satu pun `speechStart`. Gejala kedua: kunci dikirim sebagai
header HTTP, bukan di dalam `authorization.accessToken` pada frame JSON pertama — ini kesalahan yang
paling mudah terjadi karena bertentangan dengan kebiasaan. Gejala ketiga: **tidak ada frame sama
sekali** dalam 10 detik pertama, lalu koneksi ditutup server.

**Tindakan hari itu (urutan, jangan dilewati):**
1. Buka soket, kirim frame handshake, lalu **hitung** frame apa pun yang masuk dalam 30 detik. Kalau
   nol: hentikan pekerjaan proxy, jangan tambah fitur di atasnya.
2. Pindah ke **`POST /v1/asr/transcribe`** dengan satu berkas WAV hasil rekaman asli hari itu. Ini
   jalur yang sudah tertulis di ADR-0001 sebagai fallback dan tidak butuh soket.
3. Kalau REST jalan, **batalkan realtime untuk minggu ini**. Ubah alur klien: rekam penuh → unggah
   berkas → transkrip. Latensi berubah dari "langsung" ke "beberapa detik" — masih dapat diterima,
   dan gate sendiri sudah mengizinkan ini.
4. Kalau REST juga gagal dalam 2 jam: hentikan W3, alihkan hari itu ke **W1 dan W2 saja**, dan
   tuliskan status sebenarnya di README. Jangan lanjut membangun di atas jalur yang tidak terbukti.

### S2 — Video dikerjakan di dua hari terakhir, lalu keluar video yang tidak bisa ditonton tanpa suara

**Gejala awal:** pada **Sabtu 1 Nov pukul 18:00 WIB** belum ada satu berkas video yang bisa dibuka
orang lain; semua materi masih berupa tangkapan layar terpisah di laptop masing-masing. Gejala kedua:
tidak ada rekaman lapangan mentah sama sekali — hanya rekaman layar.

**Tindakan hari itu:**
1. Pada Sabtu 18:00 WIB, **hentikan seluruh fitur baru** (aturan B1 sudah menulis ini; saya hanya
   menegaskan jamnya). Tidak ada pengecualian.
2. Rekam **alur yang benar-benar jalan** apa adanya. Katakan apa yang belum ada. Video yang jujur
   tentang satu alur bekerja mengalahkan video yang memamerkan empat alur palsu — dan juri hampir
   selalu mencoba yang di video.
3. Tambahkan **teks di setiap adegan** hari itu juga. Standar: video harus terbaca tanpa suara.
4. Kalau lokasi asli tidak mungkin, ganti ke lokasi terdekat dalam Minggu 3 ini, jangan tunggu cuaca
   bagus.

### S3 — Akurasi pada ucapan beraksen menembus ambang STOP, dan tim tetap membangun

**Gejala awal:** pada 10–15 rekaman asli, WER bagian Indonesia **> 25%**, atau — yang lebih berbahaya
— WER terlihat baik tapi **angka dan dimensi gagal muncul** di dokumen acuan ("dua puluh empat meter
persegi" jadi kosong, "sembilan ratus ribu" jadi tebakan). Gejala kedua: kata-kata teknis lokal
("cakar ayam", "realpaving") tidak pernah sampai, hanya makin sering masuk `butuh_konfirmasi`.

**Tindakan hari itu:**
1. Terbitkan **lembar evaluasi dengan angka apa adanya dalam 24 jam**. Tanpa pembulatan yang
   menguntungkan. Ini sudah diwajibkan G1.
2. Terapkan rencana STOP yang sudah tertulis: hentikan pekerjaan lanjutan B, bekukan A, bekukan D.
   **Jangan** menghaluskan ambang gate setelah melihat hasil, jangan memakai kata "hampir".
3. Pemilik memilih dalam 3 hari kerja. Untuk sisa waktu 5 hari ini, satu-satunya pilihan yang jujur
   adalah **B — ganti jalur input** (ucapan pendek berstruktur) atau **C — tutup** dan kirim laporan
   temuan. Pilihan A (ganti segmen) butuh rekam ulang dan 10 sampel baru; jadwalnya tidak ada lagi.
4. Bila memilih B: bukti yang diminta adalah **makna tertangkap ≥ 90%**, bukan WER bagus. Ukur
   per-field, bukan per-kata.

---

## 3. Verifikasi lisensi — 4 paket

`web_search` **gagal: HTTP 401 (kunci API tidak valid)**. Saya lanjut ke sumber primer: `registry.npmjs.org`
dan `raw.githubusercontent.com`. Semua di bawah ini dibaca dari sumber primer, bukan dari ingatan.

| Paket | Versi diperiksa | Lisensi di sumber primer | Status |
|---|---|---|---|
| `extendable-media-recorder` | 9.2.40 | **MIT** (semua versi MIT; ada berkas LICENSE MIT di repo) | **Aman** |
| `fastify-websocket` | 4.3.0 (`latest`) | **MIT**, tapi **ditandai usang (deprecated)** | **Aman secara lisensi, tapi jangan dipakai** |
| `idb` | 8.0.4 | **ISC** (berkas LICENSE ISC di repo) | **Aman** |
| `typst` (typst/typst) | HEAD | **Apache-2.0** (LICENSE = Apache 2.0; GitHub API: `apache-2.0`; terverifikasi di `/LICENSE`; `LICENSE-APACHE` dan `LICENSE-MIT` 404, jadi repo ini benar-benar Apache murni) | **Aman** |

**Temuan yang paling penting dari tabel ini — dan ini bukan soal lisensi:**

`fastify-websocket@4.3.0` membawa pesan usang resmi dari npm:
> *"Please use @fastify/websocket@5.0.0 instead"*

Paketnya juga sudah menarik `fastify-websocket-deprecated` sebagai dependensi. Artinya **ADR-0001
menyebut nama paket yang sudah dipensiunkan.** Lisensinya MIT, jadi tidak ada masalah diskualifikasi
— tapi ini tetap harus diperbaiki karena dua hal: (a) rilis `latest`-nya dipertahankan hanya untuk
mengarahkan orang ke penggantinya, sehingga perbaikan bug tidak akan masuk ke sini; (b) menulis nama
paket yang usang di dokumen keputusan membuat pekerja backend mengejar baris yang salah.

**Tindakan:** ganti satu baris di ADR-0001 menjadi `@fastify/websocket` (nama yang sama-sama MIT,
tetap satu keluarga dengan Fastify). Ini perubahan satu kata, dan lebih murah dilakukan sekarang
daripada saat proxy sedang dikejar.

Catatan kecil: `extendable-media-recorder` menarik `standardized-audio-context`,
`recorder-audio-worklet`, dan `media-encoder-host` — jadi ia bukan paket kecil. Untuk ponsel lapangan
< Rp2 juta yang sudah jadi syarat di ADR-0001, paket ini wajar tapi **belum ada satu pun angka beban
atau RAM** yang mengukur klaim "ringan" itu. Klaim ringan itu saat ini masih asumsi, bukan hasil ukur.

Tidak ada paket yang perlu ditandai `[BELUM DIVERIFIKASI]`.

---

## 4. Bisakah keempat ADR dieksekusi 4 orang tanpa kode hari ini?

**TIDAK.**

Bukan karena orangnya kurang, dan bukan karena ADR-nya salah. Karena **ADR mengunci pilihan teknologi
tapi tidak mengunci kontrak yang membuat 4 orang bisa bekerja tanpa saling menunggu** — sementara
kontrak itu justru barang yang diminta. Tiga hal yang belum tertulis:

1. **Kontrak data klien↔server.** Belum ada satu definisi pun tentang: bentuk muatan saat audio
   putus, apakah pengiriman memakai referensi sesi atau seluruh PCM, bentuk balasan parsial, dan
   bagaimana `turnId` dipertahankan lintas unggahan tertunda. ADR-0001 dan ADR-0004 masing-masing
   menyebut "antrean IndexedDB" dan "sambung ulang", tapi **bentuk datanya tidak ada di dokumen
   mana pun**. Akibat langsung: A dan B akan membangun dua tafsiran yang baru bertemu di hari ke-4,
   dan saat itu sudah terlambat. Ini penyebab paling mungkin dari kegagalan W3.

2. **Tata kelola kunci API.** Tidak tertulis siapa yang menyimpan kunci, di mana, bagaimana kunci
   dirotasi, dan — yang paling berbahaya minggu ini — **siapa yang berwenang memakai kredit $150 dan
   berapa batas hariannya**. Batas harian $5 dan meteran disebut sebagai risiko B5, tapi tidak ada
   yang memiliki wewenang memutuskan berhenti saat biaya melonjak. Dengan 4 orang memakai kunci yang
   sama, satu proses yang lupa berhenti bisa menghabiskan kredit sebelum video selesai direkam.
   Gate 4 juga masih menyimpan "deploy produksi" dan "repo publik" sebagai keputusan pemilik yang
   **belum diberikan** — itu dua keputusan yang memblokir penilaian, bukan dua detail teknis.

3. **Urutan migrasi DB.** §3.4 mendaftar 8 tabel tanpa urutan pembuatan, tanpa status nullable, dan
   tanpa strategi perubahan skema saat 4 orang mengubah bentuk tabel bersamaan. Karena nomor dokumen
   dibuat server (D6) dan status dokumen mengalir `draft → perlu_konfirmasi → siap → terkirim`,
   urutan ini menentukan apakah guard ADR-0002 bisa menahan dokumen sama sekali. Hari ini urutannya
   tidak ada.

**Yang harus terjadi sebelum kode pertama:** bekukan ketiga hal itu sebagai satu halaman, Senin pagi
(2 Nov). Kalau tidak, "tanpa kode" hari ini berubah jadi "empat orang menulis kode yang tidak saling
sambung" pada 3 November.

---

## 5. Satu baris per ADR

- **ADR-0001 (AudioWorklet + extendable-media-recorder + fallback REST):** **tetap** — tapi ganti
  nama paket proxy dari `fastify-websocket` ke `@fastify/websocket` dan bangun jalur REST lebih dulu.
  **Revisi 29 Okt 2026 (tiket 12):** jalur REST dibangun lebih dulu, tetapi dengan `mode: ENDPOINTING`
  (Meta yang memutuskan batas giliran → `turn_N`); `@fastify/websocket` tidak dipakai karena
  backend-nya Route Handlers Next.js — proxy WSS ditangguhkan, bukan syarat submit.
- **ADR-0002 (Guard angka deterministik + `sumber_kutipan`):** **tetap** — ini keputusan terbaik dari
  keempatnya, dan satu-satunya yang langsung menghadapi risiko terbesar produk.
- **ADR-0003 (Typst):** **lebih baik: satu perender yang sudah dikuasai tim, dan kualitas cetak
  diperiksa setelah satu PDF jadi.** Alasan di keputusan itu benar (risiko B3 nyata); yang keliru
  hanya waktunya.
- **ADR-0004 (Vite + React + idb + Capacitor):** **lebih baik: pisahkan idb dari Capacitor.** `idb`
  tetap dan wajib (ISC, tanpa dependensi, 8.0.4 aktif); Capacitor dibekukan ke kalender setelah
  submit — ia menggantikan tidak satu pun bagian dari lima hari yang tersisa.
  **Revisi 29 Okt 2026 (tiket 12):** basisnya bukan `Vite + React`, melainkan Next.js `invoify`
  (App Router + `next-intl`) — lihat `docs/audit/KEPUTUSAN-ADR.md` §7. `Capacitor` tetap dibekukan;
  pilihan paket penyimpanan perangkat ditetapkan di tiket 02.

---

## Bukti dan batas pemeriksaan

**Yang saya baca (6 berkas, sesuai batas):** `suara-lapangan-adr-decisions.md`, `01-ARSITEKTUR.md`,
`02-PEMBAGIAN-KERJA.md`, `03-GATE-GO-NO-GO.md`, `README.md`, `app.js`/`index.html`.

**Hasil pemeriksaan prototipe statis — apa adanya:**
`grep` atas `fetch`, `WebSocket`, `MediaRecorder`, `AudioWorklet`, `indexedDB`, `localStorage`,
`sessionStorage`, `XMLHttpRequest`, `navigator.mediaDevices`, `getUserMedia`, dan `import`:
**nol hasil di `app.js` dan `index.html`.** Satu-satunya `href` di `index.html` adalah `styles.css`
dan ikon `data:` URI; tidak ada skrip eksternal dan tidak ada satu pun URL jaringan.

Artinya: **prototipe ini adalah mockup visual yang dikendalikan waktu, bukan prototipe teknis.** Ia
memutar ulang skrip `TURNS` yang sudah ditulis tangan di dalam berkas (`TURNS` adalah konstanta berisi
giliran bicara beserta token yang sudah ditandai), tombol rekam hanya menjalankan pengatur waktu
(`startRecording()` → `startTimer()` → `streamTranscript()`), dan "transkrip" muncul dari daftar itu —
bukan dari mikrofon. Tidak ada rekaman nyata, tidak ada pengiriman data, tidak ada penyimpanan.

Konsekuensi yang harus dibaca jujur: **video demo tidak boleh direkam dari berkas ini dan disebut
sebagai alur nyata.** Definisi selesai D sendiri sudah melarang ini ("tidak ada layar palsu"). Mockup
ini berguna untuk mengunci tata letak dan alur — dan memang sudah terlihat matang untuk itu (tipografi
besar, tombol ≥ 96 px, penanda kata Jawa `flag: 'jv'`, kontras gelap untuk luar ruangan). Tapi jarak
dari mockup ini ke W3 adalah **seluruh 5 hari kerja yang tersisa.**

**Batas pemeriksaan:** saya tidak membaca `00-RINGKASAN-PRODUK.md`, `04-RENCANA-VIDEO-DEMO.md`,
`05-RISIKO.md` secara penuh, dan tidak menjalankan prototipe di peramban. Saya tidak memanggil API Meta
mana pun dan tidak memverifikasi perilaku `muse-voice-transcribe-1.0` atau `muse-spark-1.3`.

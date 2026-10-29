# A — Audit Teknis (ADR-0001/0003, browser & PDF)

Penilai: a-teknis (Software Architect + Frontend/Mobile, pragmatis). Tanggal: 28 Okt 2026.
Pendekatan: skeptis pada over-engineering, fokus "bisa jalan dalam sisa hari kerja sampai 4 Nov".
Tanda: **[OK]** aman, **[RISIKO]** bisa gagal tapi bisa dijaga, **[SALAH]** harus diperbaiki sekarang,
**[TERVERIFIKASI]**/**[BELUM]** = status pengecekan fakta (web/token tak bisa dipakai → jujur ditandai).

**Konteks terukur:** prototipe hari ini 100% lokal tanpa jaringan/model — `grep -c "fetch(" app.js`
= 0, tidak ada `MediaRecorder`/`getUserMedia`/`WebSocket`/`indexedDB` di `app.js`; nomor dokumen
di-hardcode `app.js:9` (`DOC_NUMBER = '014/SP/CV-SJ/X/2026'`). Jadi seluruh jalur audio/ASR/PDF di
bawah ini **belum ada kodenya**, bukan "sudah jalan".

---

## 1) [SALAH] Tiga angka sample rate beradu; pilih **16 kHz s16le mono** untuk MVP

Bukti konflik: `docs/01-ARSITEKTUR.md:14` ("rekam 16 kHz PCM mono") vs `:74` ("PCM s16le mono **24 kHz**")
vs kontrak handshake `:92` (`"audioEncoding": "PCM_24KHZ"`) vs ADR-0001:13 ("PCM **16/24** kHz mono").
Satu dokumen, tiga jawaban. Ini bukan detail kosmetik: `audioEncoding` salah = sesi realtime ditolak.

**Keputusan yang saya sarankan: 16 kHz** (`PCM_16KHZ`), untuk ketiga jalur (realtime, WAV lokal, REST).
Alasan: batas file REST 10 menit / 32 MB (`docs/00-RINGKASAN-PRODUK.md:113`) dan rate yang sama
menghindari dua encoder berbeda + resample di server (`01:74` bilang 24 kHz default & 16 kHz di-resample).
Syarat: rate itu **tidak saya uji ke API** — sebelum kode ditulis, satu orang wajib mengirim 10 detik
audio ke sesi realtime dua kali (16 kHz dan 24 kHz) dan mencatat mana yang diterima. Kalau 16 kHz
ditolak, balik ke 24 kHz (rate native) — bukan sebaliknya.

**Hitungan ukuran WAV 10 menit, mono, 16-bit** (rumus: detik × rate × 2 byte; blok header `data`/RIFF
hanya ±44 byte, diabaikan):

| Rate | Hitungan | Ukuran | vs batas 32 MB (`00:113`) |
|---|---|---|---|
| 16 kHz | 600 × 16.000 × 2 B = 19.200.000 B | **19,2 MB** (19,2 MB desimal / 18,3 MiB) | sisa 12,8 MB — aman |
| 24 kHz | 600 × 24.000 × 2 B = 28.800.000 B | **28,8 MB** (27,5 MiB) | sisa 3,2 MB — **melewati ambang tipis** |

Kesimpulan: angka di tugas **terkonfirmasi** (19,2 dan 28,8 MB). Tapi angka "aman" ini hanya untuk
**satu** rekaman. Untuk O1 (unggah tertunda) ukurannya berbahaya: 10 menit @24 kHz = 28,8 MB, dan
jatah penyimpanan IndexedDB per origin bisa dipangkas browser. **Aturan wajib: rekaman dipotong
per giliran bicara (≤ 60 detik, ≤ 2,9 MB @16 kHz), bukan satu blob 10 menit**, dan WAV dikompres
(Opus/AAC) setelah masuk antrean. Kirim selalu ≤ 60 detik per request REST → jauh di bawah batas
10 menit dan 32 MB, jadi soal batas hilang sama sekali.

## 2) [RISIKO] `extendable-media-recorder` sulit dipertahankan; AudioWorklet + MediaRecorder native cukup

[TERVERIFIKASI sebagian] Klaim "★355, MIT" ada di ADR-0001:11 dan `:13`; **saya tidak bisa memukul
registry/repo karena token web_search mati (HTTP 401)**, jadi angka bintang & lisensi tetap
**[BELUM]** terverifikasi dari sumber primer. Ini justru masalahnya: aturan §4 guide hackathon
(halaman 4: *"use code, data, atau assets you do not have the rights to"* = **diskualifikasi**) membuat
setiap paket baru adalah risiko yang tidak perlu diambil untuk demo 5 hari.

Pendapat saya sebagai engineer pragmatic: `extendable-media-recorder` adalah pembungkus MediaRecorder
untuk menghasilkan format kustom. Kebutuhan kita cuma PCM mentah — itu bisa didapat langsung dari
`AudioWorklet` (sampel Float32 → ubah ke Int16 → kirim/`POST`), dan untuk simpan lokal cukup
`MediaRecorder` boolean `audio/webm;codecs=opus` yang **built-in browser** (0 KB unduhan, 0 lisensi).
**1 alasan mempertahankan** kalau tetap dipakai: paket ini sudah menangani quirk MediaRecorder
lintas-Safari/Android lama (format MIME tidak konsisten) sehingga tim tidak perlu menulis
feature-detect sendiri. **1 alternatif lebih kecil: AudioWorklet (native) + MediaRecorder webm/OPUS
(native)**, tanpa dependensi pihak ketiga sama sekali. Rekomendasi: **pakai alternatif**; simpan
opsi pustaka hanya jika terbukti gagal di >1 ponsel. Sama untuk `ricky0123/vad`: ADR menangguhkan
karena `NOASSERTION` — **itu keputusan yang benar**, dan alasan teknisnya juga benar (VAD klien
menambah RAM); catat di README sebagai "tidak dipakai" supaya juri tidak berpikir kodenya diambil.

## 3) [RISIKO] Typst dipilih — tapi klaim "<50 ms" dan "aman di Node" harus diklaim ulang

[TERVERIFIKASI] keputusan = `typst/typst`, ★56,867, Apache-2.0 (ADR-0003:25) — **[BELUM]** saya cek
sumber primer. Dua hal yang harus jujur:

- **Cara deploy.** Typst adalah **binary Rust**, bukan pustaka Node yang di-`npm install`. Artinya
  server memanggil `child_process.spawn('typst', ['compile', ...])` → perlu **binary di server/host**
  (unduh rilis, atau image Docker). Ini berarti: `SALAH` bila dokumen menyiratkan "import typst ke
  Node". Tidak ada jembatan resmi Typst→Node yang saya bisa buktikan **[BELUM]**.
- **Klaim "<50 ms" tidak punya bukti di repo ini.** `ADR-0003:27` menulis "menjamin kompilasi
  ultra-cepat (<50 ms)". Tanpa angka terukur, itu klaim karangan. **Klaim ulang menjadi: "waktu
  kompilasi diukur di server kami; lihat tabel X"**, atau hapus angkanya. Kalau tetap ingin angka:
  ukur 20 render dan tulis median + p95, jangan tulis angka bulat ideal.
- **Font Indonesia:** Typst butuh font file yang di-embed (`--font-path`). Pakai font sistem yang
  lisensinya aman (mis. Liberation/DejaVu yang OFL/GPL+font-exception, atau font Google OFL) —
  **jangan** pakai font berbayar perusahaan. Ini masalah lisensi, sama seperti poin 2.
- **Kop/stempel/tanda tangan:** keduanya cuma gambar PNG/JPG yang di-embed di template Typst; itu
  justru kekuatan Typst (posisi presisi). Untuk demo, **pakai stempel contoh** (bukan milik CV nyata)
  supaya tidak ada klaim/berkas pihak lain.
- **Tabel RAB multi-halaman:** ini keunggulan nyata Typst dibanding `@react-pdf` yang header/footer
  berulangnya lebih repot. Alasan praktis memilih Typst: 1 template `.typ` = 1 file teks mudah
  di-review, dan kalau kalah cepat masih bisa jatuh ke `@react-pdf` karena keduanya sama-sama
  dari JSON yang sama (D5 `01:63`).

**Pilihan untuk 5 hari sisa: Typst**, tapi dengan syarat: (a) binary dijalankan via `child_process`,
(b) font di-embed dari font OFL, (c) hapus/ukur klaim <50 ms, (d) template hanya **1 jenis dokumen**
dulu (Surat Penawaran — satu-satunya yang ada di prototipe), bukan tiga. Alasan praktis: presisi kop
& tabel, dan template-nya file teks yang bisa diperbaiki cepat Senin pagi.

> **Catatan 29 Okt 2026 (tiket 12 — dokumen sudah disinkronkan):** rekomendasi Typst di atas **tidak
> dipakai**. Keputusan pemilik Q1 (basis Next.js `invoify`) menetapkan perender untuk submit =
> pipeline `invoify` (HTML + CSS cetak → Chromium headless → `page.pdf()`); `Typst` tetap dibekukan
> sampai submit, dan `@react-pdf/renderer` hanya fallback (belum terpasang). Lihat
> `docs/01-ARSITEKTUR.md` §3.3 dan `docs/audit/KEPUTUSAN-ADR.md` §7.

## 4) [RISIKO] Fallback REST cukup untuk demo, asal demo-nya bukan "live realtime"

Fallback `POST /v1/asr/transcribe` (`00:112–113`, ADR-0001:13) **cukup** untuk demo 3 menit, karena
rekaman 3 menit @16 kHz = 180 × 16.000 × 2 = **5,76 MB**, jauh di bawah batas 32 MB dan 10 menit.
Tapi ada satu **risiko nyata**: fallback REST bukan transkrip streaming — tidak ada `speechStart`/
`partialMode`/`turnId` langsung. Jadi `sumber_kutipan` (ADR-0002) tidak punya `turnId` asli. Solusi
murah: server memotong audio menjadi segmen ±20–30 detik, mengirim tiap segmen ke REST, dan
**server yang memberi `turnId` (urn lokal `seg_1`, `seg_2`…)**. Itu jujur: `turnId` = segmen yang
kita kirim, bukan klaim timestamp model. Arsipkan segmen → bukti kutipan tetap bisa ditunjukkan
(juri klik angka → dengar detik ke-N), dan itu bukti audit <15 detik.

> **Catatan 29 Okt 2026 (tiket 12 — dokumen sudah disinkronkan):** bagian ini **tidak dipakai lagi**.
> Keputusan pemilik Q2 memakai `mode: ENDPOINTING`, di mana **Meta yang mengembalikan `turns[]`
> dengan `startMs`/`endMs`**, dan server menormalkannya menjadi `turn_1..turn_N` — jadi tidak ada
> pemotongan segmen manual. Lihat `docs/01-ARSITEKTUR.md` §3.2 dan `docs/audit/KEPUTUSAN-ADR.md` §7.

**Jaminan minimal untuk 1 demo jalan** (harus ada sebelum Senin):
1. Halaman rekam: `getUserMedia` + `MediaRecorder`(webm) → simpan blob → tombol "Selesai".
2. Satu endpoint server `POST /api/doc` yang menerima audio → REST transcribe per segmen → Spark 1.3
   (`text.format: json_schema` per `01:116`) → satu template PDF → kembalikan URL.
3. Rekaman cadangan: **audio demo diprekam lebih dulu** dan disimpan sebagai file fixture; tombol
   demo memutar alur yang sama tanpa bergantung WiFi venue. Ini bukan "demo palsu" selama ditulis
   jelas "audio direkam 30 Okt di lokasi X" — aturan §4 hanya melarang menampilkan karya lama.
4. Tidak ada WebSocket realtime di jalur demo; realtime = "berikutnya", bukan "hari ini".

## 5) Ringkasan keputusan (1 baris masing-masing)

| # | Hal | Putusan |
|---|---|---|
| 1 | Sample rate | **[SALAH]** 16 kHz s16le mono di semua jalur; uji 10 detik ke realtime sebelum kode. |
| 2 | Pustaka audio | **[RISIKO]** AudioWorklet + MediaRecorder native; `extendable-media-recorder` & `vad` dicadangkan. |
| 3 | PDF | **[RISIKO]** Typst via `child_process` + font OFL; klaim "<50 ms" diukur atau dihapus. |
| 4 | Fallback | **[OK]** REST per segmen ≤60 detik cukup untuk demo; `turnId` dibuat server. |
| 5 | Klaim §4 | Semua lisensi wajib dicek dari file LICENSE sebelum repo publik (**[BELUM]** terverifikasi hari ini). |

**Batas jujur audit ini:** token pencarian web mati (HTTP 401), jadi bintang/lisensi pustaka
**tidak** saya verifikasi dari sumber primer — itu tugas D (adversarial). Yang terukur di sini:
hitungan ukuran WAV, baris dokumen yang berkonflik, dan fakta prototipe tanpa jaringan.

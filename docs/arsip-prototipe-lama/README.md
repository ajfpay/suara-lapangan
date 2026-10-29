# Suara Lapangan

Mengubah ucapan pekerja lapangan dan kontraktor kecil — dalam **Native English** (pasar global) maupun
**Bahasa Indonesia beraksen daerah** (diselingi kata daerah/Jawa dan istilah teknis Inggris) — menjadi
**dokumen resmi siap kirim ke klien** dalam **Bahasa Inggris (`Quotation / Estimate`, `Daily Field Report`,
`Change Order`)** maupun **Bahasa Indonesia (`Surat Penawaran`, `Laporan Harian`, `Berita Acara`)**.

Bukan transkrip mentah. Dokumen. Mendukung penuh **Native English** dan **Bahasa Indonesia** (keduanya
masuk dalam 25 bahasa resmi `muse-voice-transcribe-1.0`), serta bersikap jujur terhadap kata daerah di
luar cakupan model (seperti kata Jawa murni: ditandai tidak pasti lalu dikonfirmasi ke pekerja, bukan ditebak).

> **Status repositori:** fase **dokumen perencanaan**. Belum ada kode, belum ada repo publik.
> Repositori GitHub publik dan implementasi menunggu arahan pemilik produk
> (28 Oktober 2026).

---

## Dokumen

| Berkas | Isi |
|---|---|
| [`docs/00-RINGKASAN-PRODUK.md`](docs/00-RINGKASAN-PRODUK.md) | Produk, masalah, pengguna, cakupan 1 dokumen penuh (`Surat Penawaran`) + 2 skema siap, metrik, batas teknis |
| [`docs/01-ARSITEKTUR.md`](docs/01-ARSITEKTUR.md) | Diagram, keputusan D1–D10 (16 kHz mono, REST `ENDPOINTING` → `turns[]` Meta → `turn_N`, Guard §B2, PDF pipeline `invoify`/Chromium `page.pdf()`), Kontrak Beku K1–K7 |
| [`docs/02-PEMBAGIAN-KERJA.md`](docs/02-PEMBAGIAN-KERJA.md) | Gate Harian GD1–GD4 (tenggat 3 Nov 16:59 UTC), peta jalan 6 minggu pasca-hackathon, aturan kerja 4 orang |
| [`docs/03-GATE-GO-NO-GO.md`](docs/03-GATE-GO-NO-GO.md) | Putusan Gate Pra-Implementasi (`GO BERSYARAT`), Pre-Flight Checklist 7 butir, Gate Harian GD1–GD4 & Gate 0–5 |
| [`docs/04-RENCANA-VIDEO-DEMO.md`](docs/04-RENCANA-VIDEO-DEMO.md) | Papan cerita per detik (`Surat Penawaran` E2E + bukti Guard 20 dtk), batas klaim jujur, daftar periksa |
| [`docs/05-RISIKO.md`](docs/05-RISIKO.md) | Risiko peringkat (K1–K4, B1–B6, S1–S7), kepatuhan lisensi paket, pemicu, tindakan, pemilik |
| [`docs/audit/KEPUTUSAN-ADR.md`](docs/audit/KEPUTUSAN-ADR.md) | Putusan Juri Arsitektur (ADR-0001..0005) & Pengesahan Gate Pra-Implementasi Multi-Agen (`ao`) |

## Model Meta yang dipakai

| Model | Peran | Catatan |
|---|---|---|
| **Muse Voice Transcribe** (`muse-voice-transcribe-1.0`) | Inti: ucapan → transkrip per giliran bicara | REST `ENDPOINTING` (jalur utama; Meta yang memutuskan batas giliran) + WSS realtime (ditangguhkan); mendukung penuh **Native English & Bahasa Indonesia** (25 bahasa code-switching; kata daerah seperti Jawa ditandai untuk dikonfirmasi) |
| **Muse Spark 1.3** (`muse-spark-1.3`) | Transkrip → data terstruktur → dokumen | Structured output via `json_schema` |
| **Muse Spark 1.2** (`muse-spark-1.2`) | Cadangan untuk teks | — |
| **Muse Glimmer** (30B, Apache 2.0) | Jalur "Best Open Weight" di satu laptop | Status: **dirancang, belum diuji dengan angka**. Bukan fitur offline di ponsel |
| **Muse Spark Open** (816B MoE) | Tidak direncanakan untuk MVP | — |

## Yang perlu diketahui pembaca baru

1. **Tidak mengetik.** Seluruh alur dirancang untuk tangan bersarung di lokasi proyek (pasar global & Indonesia).
2. **Dwibahasa penuh (`Native English` + `Bahasa Indonesia`), jujur terhadap bahasa daerah.** `English` dan
   `Indonesian` didukung secara native untuk input suara, Guard Angka deterministik, hingga cetak PDF resmi
   (`Quotation / Estimate` dalam USD maupun `Surat Penawaran` dalam IDR). Kata daerah di luar 25 bahasa resmi
   (mis. kata Jawa murni) ditandai tidak pasti lalu dikonfirmasi ke pekerja — tidak pernah ditebak.
3. **Angka uang tidak pernah dikarang.** Setiap angka wajib dapat ditelusuri ke giliran bicara;
   yang tidak jelas ditanyakan, bukan ditebak.
4. **Tanpa sinyal, catatan tetap tersimpan** (unggah tertunda). Tidak ada klaim transkripsi
   offline di ponsel.
5. **Video adalah 25% nilai.** Versi 1 selesai pada **Hari 3 (`GD3` — 2 Nov 2026)** dengan tenggat submit internal **Selasa 3 Nov 2026, 16:59 UTC (23:59 WIB)**.

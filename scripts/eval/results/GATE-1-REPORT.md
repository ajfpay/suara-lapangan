# Laporan Evaluasi WER & Gate 1 (Suara Lapangan MVP)

> **PERINGATAN PENTING (B1 — CIRCULAR ORACLE NOTICE):**
> Hipotesis transkripsi saat ini berasal dari mock K5 sintetis (`scripts/eval/fixtures/k5/`) yang diturunkan dari transkrip acuan (`fixtures/transcripts/`).
> Angka WER di bawah ini adalah **uji asap pipeline (pipeline smoke test)** untuk memverifikasi alur `transcribeSession` dan kalkulasi WER, **BUKAN pengukuran akurasi model ASR Meta yang sebenarnya**.
> Gate 1 **TIDAK memberikan status GO untuk akurasi ASR** berdasarkan data sintetis. Untuk mengukur akurasi riil, sediakan hipotesis ASR nyata melalui opsi `realHypothesesDir` atau `isRealAsr`.

---

- **Tanggal Evaluasi:** 2026-10-30T00:28:20.553Z
- **Status Gate 1:** **SYNTHETIC SMOKE TEST PASS (PIPELINE OK — BUKAN GO AKURASI ASR)**
- **Mode Evaluasi:** `synthetic_smoke` (scripts/eval/fixtures/k5 (synthetic mocks))
- **Jumlah Rekaman Diuji:** 30 (15 EN + 15 ID)
- **Defective Cases Dicatat/Didaftar:** 12

---

## 1. Ringkasan Metrik Akurasi (Uji Asap Sintetis)

| Bahasa / Metrik | Realisasi WER | Ambang Batas Target | Status |
| --- | --- | --- | --- |
| **Native English (EN)** | **7.17%** (22/307 kata) | $\le$ 10.00% | PASS |
| **Indonesia Beraksen (ID)** | **10.64%** (30/282 kata) | $\le$ 15.00% | PASS |
| **Token Uang/Volume (EN)** | **5.98%** (7/117 token) | $\le$ 10.00% | PASS |
| **Token Uang/Volume (ID)** | **2.99%** (5/167 token) | $\le$ 10.00% | PASS |
| **Token Uang/Volume (Total)** | **4.23%** (12/284 token) | $\le$ 10.00% | PASS |
| **Total Gabungan** | **8.83%** (52/589 kata) | — | — |

---

## 2. Keputusan Gate 1 (Go / No-Go)

- **Status:** `SYNTHETIC_SMOKE_PASS`
- **Tipe Evaluasi:** `SYNTHETIC_SMOKE_TEST (Akurasi ASR Belum Diuji)`
- **STOP 24 Jam Triggered:** `false`
- **Eskalasi ke:** `None`
- **Alasan Keputusan:**
  - Pipeline smoke test PASSED: Both EN (WER 7.17% <= 10%) and ID (WER 10.64% <= 15%) meet numerical thresholds under synthetic mock perturbations.
  - Money/volume WER (4.23%) meets <= 10% threshold.
  - Gate 1 ASR Accuracy NOT CERTIFIED: Evaluated hypotheses are synthetic mocks derived from reference transcripts (circular oracle). WER measures authored perturbation, NOT Meta ASR accuracy. Gate 1 GO on ASR accuracy cannot be granted without real ASR hypotheses.

### Aturan Batas Gate 1:
- **EN WER $\le$ 10%:** Memenuhi standar kontraktor global.
- **ID WER $\le$ 15%:** Memenuhi standar ucapan Indonesia beraksen daerah.
- **ID WER > 25%:** STOP 24 jam dan eskalasi ke pemilik produk untuk keputusan pivot jalur/segmen.
- **Token Uang/Volume $\le$ 10%:** Integritas angka dimensi, satuan, dan harga beruang terjaga.

---

## 3. Sampel Terburuk (Honest Reporting — No Dropped Samples)

Berikut 10 sampel dengan WER tertinggi:

| Rank | Recording ID | Locale | WER | Distance / Words | Money/Volume WER |
| --- | --- | --- | --- | --- | --- |
| 1 | `en-11-hallway-trim` | EN | 46.15% | 12/26 | 12.50% |
| 2 | `id-07-tenaga-harian` | ID | 17.65% | 3/17 | 11.11% |
| 3 | `en-03-recessed-lights` | EN | 13.33% | 2/15 | 40.00% |
| 4 | `id-12-instalasi-air` | ID | 13.33% | 2/15 | 12.50% |
| 5 | `id-15-kusen` | ID | 11.76% | 2/17 | 0.00% |
| 6 | `id-04-titik-lampu` | ID | 11.11% | 2/18 | 9.09% |
| 7 | `id-06-galian-pondasi` | ID | 11.11% | 2/18 | 0.00% |
| 8 | `id-08-kayu-kaso` | ID | 11.11% | 2/18 | 20.00% |
| 9 | `id-10-bongkar-dinding` | ID | 11.11% | 2/18 | 0.00% |
| 10 | `id-11-semen-dan-besi` | ID | 11.11% | 3/27 | 0.00% |

---

## 4. Inventarisasi Kasus Cacat (Defective Fixtures)

Total kasus cacat yang dicatat/didaftar: **12** berkas (inventarisasi metadata berkas cacat, bukan pengujian guard otomatis).

| Defect Code | Jumlah Kasus |
| --- | --- |
| `harga_lolos_sebagai_volume` | 1 |
| `satuan_salah` | 1 |
| `desimal_koma_id` | 1 |
| `ratus_puluh_tertukar` | 1 |
| `kutipan_sesi_lain` | 1 |
| `kutipan_non_final` | 1 |
| `twelve_hundred_en` | 1 |
| `setengah_juta_id` | 1 |
| `angka_tidak_ada_di_giliran` | 1 |
| `jumlah_tidak_cocok` | 1 |
| `total_tidak_cocok` | 1 |
| `satuan_hilang` | 1 |

Semua berkas hasil rekaman per individu tersimpan di direktori ini dalam format JSON.

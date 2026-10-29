# Laporan Evaluasi WER & Gate 1 (Suara Lapangan MVP)

- **Tanggal Evaluasi:** 2026-10-29T10:04:51.612Z
- **Status Gate 1:** **STOP 24 JAM (ESKALASI PEMILIK)**
- **Jumlah Rekaman Diuji:** 30 (15 EN + 15 ID)
- **Defective Cases Diverifikasi:** 12

---

## 1. Ringkasan Metrik Akurasi

| Bahasa / Metrik | Realisasi WER | Ambang Batas Target | Status |
| --- | --- | --- | --- |
| **Native English (EN)** | **3.72%** (11/296 kata) | $\le$ 10.00% | PASS |
| **Indonesia Beraksen (ID)** | **100.35%** (283/282 kata) | $\le$ 15.00% | FAIL |
| **Token Uang/Volume (EN)** | **5.98%** (7/117 token) | $\le$ 10.00% | PASS |
| **Token Uang/Volume (ID)** | **100.00%** (167/167 token) | $\le$ 10.00% | PASS |
| **Token Uang/Volume (Total)** | **61.27%** (174/284 token) | $\le$ 10.00% | PASS |
| **Total Gabungan** | **50.87%** (294/578 kata) | — | — |

---

## 2. Keputusan Gate 1 (Go / No-Go)

- **Status:** `STOP_24_JAM`
- **STOP 24 Jam Triggered:** `true`
- **Eskalasi ke:** `pemilik`
- **Alasan Keputusan:**
  - Indonesian WER (100.35%) exceeds the 25.0% hard-stop threshold. Marking STOP 24 jam and escalating to pemilik for segment/route pivot decision.

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
| 1 | `id-12-instalasi-air` | ID | 106.67% | 16/15 | 100.00% |
| 2 | `id-01-pasang-keramik` | ID | 100.00% | 23/23 | 100.00% |
| 3 | `id-02-semen-plester` | ID | 100.00% | 17/17 | 100.00% |
| 4 | `id-03-besi-cor-dak` | ID | 100.00% | 19/19 | 100.00% |
| 5 | `id-04-titik-lampu` | ID | 100.00% | 18/18 | 100.00% |
| 6 | `id-05-plester-dinding` | ID | 100.00% | 19/19 | 100.00% |
| 7 | `id-06-galian-pondasi` | ID | 100.00% | 18/18 | 100.00% |
| 8 | `id-07-tenaga-harian` | ID | 100.00% | 17/17 | 100.00% |
| 9 | `id-08-kayu-kaso` | ID | 100.00% | 18/18 | 100.00% |
| 10 | `id-09-pengecatan` | ID | 100.00% | 19/19 | 100.00% |

---

## 4. Verifikasi Kasus Cacat (Defective Fixtures)

Total kasus cacat yang diuji guard: **12** berkas.

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

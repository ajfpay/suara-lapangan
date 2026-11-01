# Rencana Eksekusi — Phase 3 (topologi worktree, pekerja, PR)

- **Task Slug:** `auth-admin-providers`
- **Spec:** `docs/specs/auth-admin-providers/2026-11-01-auth-admin-providers-spec.md`
- **Graf:** `.scratch/auth-admin-providers/execution-graph.md`
- **Status:** APPROVED — Gate 1, Gate 2, Gate 3 disetujui pemilik 1 Nov 2026; tiket 08 tetap blocked menunggu izin tertulis

## 1. Peta worktree & cabang

Satu worktree + satu cabang per tiket yang bisa berjalan paralel; worktree bersaudara dari repo utama `~/repos/suara-lapangan`.

| Tiket | Worktree | Cabang | Resume dari cabang/worktree yang ada? | Pemilik berkas |
|---|---|---|---|---|
| 01 | `~/repos/suara-lapangan-w11-auth-admin` | `agent/11-auth-admin` | **Ya — lanjutkan** (backend Better Auth, migrasi 0005/0006, seed-admin, kuota, document store sudah ada; yang kurang: UI login, middleware, email confirm) | Auth |
| 02 | `~/repos/suara-lapangan-w11-auth-admin` | `agent/11-auth-admin` | **Ya — lanjutkan pada cabang yang sama** (admin + Dokumen saya + ownership) | Admin |
| 03 | `~/repos/suara-lapangan-w12-llm-provider` (pending) | `agent/12-llm-provider-config` | **Pending** — worktree belum dilaporkan oleh thread provider; entri akan diisi setelah pemilik meneruskannya. Cabang sudah ada, belum ada perubahan. | Providers |
| 04 | `~/repos/suara-lapangan-w04-model` (baru) | `agent/04-model-client` | Tidak (baru) | Model |
| 05 | `~/repos/suara-lapangan-w05-model-caps` (baru) | `agent/05-model-capabilities` | Tidak (baru) | Model |
| 06 | `~/repos/suara-lapangan-w06-openai-compat` (baru) | `agent/06-openai-compat` | Tidak (baru) | Providers |
| 07 | `~/repos/suara-lapangan-w03b-meta-features` | `agent/03b-meta-features` | **Ya — lanjutkan** (21 berkas sudah diubah: meta.ts, turns.ts, vocabulary.ts, route, store, migrasi 0005_asr_speaker.sql, UI progress, realtime script, fixtures) | ASR |
| 08 | `~/repos/suara-lapangan-w08-deploy` (baru) | `agent/08-deployment` | Tidak (baru); **blocked — menunggu izin tertulis pemilik** untuk repo publik dan deploy; jangan dimulai | Infra |

Aturan: pekerja tidak menyentuh worktree pekerja lain; worktree gagal **disimpan** untuk pemeriksaan, bukan dihapus. Tiket 01 dan 02 berbagi worktree `w11` (satu cabang, dua tiket berurutan — bukan paralel). Tiket 03 dan 06 berbagi worktree `w12` (berurutan). Tiket 04 dan 05 berbagi worktree baru `w04` (berurutan).

## 2. Batas PR & urutan landing

Karena 01/02 dan 03/06 dan 04/05 berbagi cabang, mereka menjadi **satu PR per cabang** dengan commit terpisah per tiket. 07 dan 08 masing-masing satu PR.

```
PR A: agent/11-auth-admin -> main
├── Commit 1: feat(auth): login, register, email confirmation, middleware (Ticket 01)
└── Commit 2: feat(admin): dashboard + Dokumen saya + ownership (Ticket 02)

PR B: agent/12-llm-provider-config -> main   (worktree pending)
├── Commit 1: feat(providers): admin provider settings (Ticket 03)
└── Commit 2: feat(providers): openai-compatible provider (Ticket 06)

PR C: agent/04-model-client -> main
├── Commit 1: feat(model): client — 3 protocols, structured output, reasoning, caching, token count (Ticket 04)
└── Commit 2: feat(model): streaming, tools, search grounding, files, images, video, SAM (Ticket 05)

PR D: agent/03b-meta-features -> main
└── Commit 1: feat(asr): DIARIZATION, vocabulary, en+id hint, progress, realtime script (Ticket 07)

PR E: agent/08-deployment -> main
└── Commit 1: chore(deploy): public repo + live deployment (Ticket 08, owner approval)
```

Urutan landing (dari akar dependensi ke atas): **PR A → PR B → PR C → PR D → PR E**. PR E (tiket 08) **blocked** sampai izin tertulis pemilik untuk repo publik dan deploy; tidak dimulai sebelum izin tercatat.

## 3. Pekerja, verifikator, integrasi

Pool yang hidup di mesin ini (sesuai konvensi MVP): `senior-developer`, `task`, `test-automation-engineer`, `minimal-change-engineer`. Tidak memakai agen yang tidak terdefinisi.

| Tiket | Pekerja | Verifikator | Integrasi worker (bila overlap) |
|---|---|---|---|
| 01 | `senior-developer` (resume w11) | `test-automation-engineer` | — |
| 02 | `senior-developer` (resume w11) | `test-automation-engineer` | integrasi worker pada `app/api/documents/**` (fan-in dengan guard owner) |
| 03 | `senior-developer` (resume w12, pending) | `test-automation-engineer` | integrasi worker pada admin layout (fan-in dengan 02) |
| 04 | `senior-developer` | `test-automation-engineer` | — |
| 05 | `senior-developer` | `test-automation-engineer` | — |
| 06 | `task` | `test-automation-engineer` | integrasi worker pada `lib/server/providers/**` (fan-in dengan 03) |
| 07 | `senior-developer` (resume w03b) | `test-automation-engineer` | integrasi worker pada `i18n/locales/{en,id}.json` |
| 08 | `minimal-change-engineer` (+ pemilik untuk flip publik) | pemilik | — |

Planner agents publish tasks and do not edit code. Satu worker = satu tiket = satu worktree. Verifikator memeriksa acceptance criteria tiap worker. Integrasi worker dipakai bila cabang overlap atau slice dependen butuh fan-in.

## 4. Cek penasihat Jev pada penugasan (advisory, wajib — dijalankan 1 Nov 2026)

`jev_decide` (5 pertanyaan: 4 `score` per agen per peran + 1 `noul`) via `~/.omp/scripts/jev_helper.py` (input 740 token, biaya $0,00).

| Agen / peran | Skor Jev (0–4) | Catatan |
|---|---|---|
| `senior-developer` / worker kompleks | 2,85 | good–excellent; cocok untuk backend berat |
| `task` / worker kecil | 2,52 | adequate–good; cocok untuk tiket kecil |
| `test-automation-engineer` / verifier | 1,79 | adequate — **divergensi lembut**: Jev menilai verifier hanya adequate, bukan excellent |
| `minimal-change-engineer` / integrasi | 2,09 | adequate |

**Divergensi yang harus diangkat ke pemilik (Gate 3):**
- `noul` "risiko independent review berkurang karena keluarga agen yang sama dipakai worker+verifier" = **0,57** (zona abu-abu). Manual topology sudah memakai agen berbeda (senior-developer/task sebagai worker, test-automation-engineer sebagai verifier), jadi independent review terjaga. Namun Jev menilai verifier hanya 1,79/4. **Rekomendasi:** pertahankan pemisahan worker≠verifier (sudah ada), dan pertimbangkan verifier yang lebih kuat bila tersedia; di mesin ini hanya pool di atas yang hidup, jadi pertahankan dengan catatan ini. Jev tidak menggantikan keputusan manual.

## 5. Persyaratan approval

- Gate 1: spec disetujui (status DRAFT).
- Gate 2: tiket + graf disetujui (graf klasifikasi Jev = manual, tidak ada divergensi).
- Gate 3: topologi + penugasan + batas PR disetujui (divergensi verifier + i18n conflict + pending worktree w12 diangkat di sini).
- Tidak ada auto-merge; merge per gelombang hanya oleh manusia.
- Tiket 08 (repo publik + deploy) **blocked** — menunggu izin tertulis pemilik; tidak dimulai sampai izin tercatat.

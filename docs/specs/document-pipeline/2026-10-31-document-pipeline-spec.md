# SPEC — Document Pipeline (creation, storage, numbering, PDF, email)

- **Date:** 31 Oct 2026 · **Status:** DRAFT — awaiting owner approval
- **Decision owner:** Product Owner (decisions 1–7 recorded in the orchestration thread, 31 Oct 2026)
- **Scope of this document:** connecting the working server pipeline to the UI, durable document
  storage, server numbering, the Dokumen screen with Unduh/Kirim, and the hardening items the
  Phase 1 audit flagged.
- **Authoritative sources:** owner decisions of 31 Oct 2026 (this spec encodes them as
  requirements, not options); Phase 1 read-only validation of repo `main` `eb7dabd` (thread
  `T-01a18512-9373-7604-8d21-5b45b2a3b5e4`); `docs/specs/suara-lapangan-mvp/2026-10-28-suara-lapangan-mvp-spec.md`
  (D1–D12, still binding where not superseded here); `docs/01-ARSITEKTUR.md` §3.3–§3.4.
- **All file:line citations refer to `main` `eb7dabd`** and describe current behaviour; they are
  evidence, not targets. Where this spec supersedes them, the supersession is named.

---

## Problem Statement

A foreman records a job, reviews the turns, and confirms the numbers — and then hits a wall. The
screens exist (Rekam → Susun → Dokumen, `lib/seo.ts:15-19`), the server pipeline works
(ASR → Spark 1.3 → guard → PDF are all implemented and tested), but **no user action ever produces
a document**: the server-side document endpoint is only ever called by an external e2e test, the
confirmation screen cannot load a document (it calls a `GET` the server does not implement and
silently renders nothing), and the Dokumen screen is still the static placeholder from ticket 01
(`app/[locale]/dokumen/page.tsx:40` renders only `stepPage.workList(step)`).

For the user this means the product's promise — *speak the job, get a client-ready PDF* — stops one
step short. A mandor who finishes confirming numbers has no document, no PDF, no way to send
anything to a client.

## Solution

On the Susun screen the user presses one button, **"Buat dokumen"**. The server creates the
document (Spark 1.3 + guard, exactly as today), stores it durably, assigns it a yearly sequential
number, and renders its PDF to disk. The user stays on Susun; a **"Lihat dokumen"** action then
takes them to the Dokumen screen, which shows the PDF and offers **Unduh** (download) and
**Kirim** (send by email). No navigation happens automatically at creation.

Everything about a document is durable: the record lives in the existing Postgres database, the
PDF file lives on disk. Nothing about documents remains in memory only.

## Current state (evidence baseline)

Facts this spec builds on, each verified in the repo:

| # | Current behaviour | Evidence |
|---|---|---|
| B1 | `POST /api/documents` creates the document (Spark or deterministic fallback → guard) and returns `{document, butuh_konfirmasi, status}` | `app/api/documents/route.ts:22`, response at `:212-221` |
| B2 | It stores the result in an **in-memory** bounded map, keyed by sessionId, evicted at 500 entries, lost on restart | `app/api/documents/route.ts:163` and `:208`; `lib/server/guard/documentStore.ts:9-18, 30-42` |
| B3 | `PATCH /api/documents/{id}` confirms/corrects a field, clears it from `butuh_konfirmasi`, recomputes `jumlah`/`total_nominal`/`terbilang` server-side, promotes status to `siap` only when the list is empty | `app/api/documents/[id]/route.ts:148-211` |
| B4 | `GET /api/documents/[id]/pdf` re-exports the PDF route; the PDF route refuses 409 while `butuh_konfirmasi` is non-empty, renders via Chromium `page.pdf()`, and caches in memory keyed by `nomor` + content hash | `app/api/documents/[id]/pdf/route.ts:3`; `app/api/pdf/[id]/route.ts:52-93` |
| B5 | `KonfirmasiPanel` fetches `GET /api/documents?sessionId=…` on mount; the documents route exports **only `POST`**, so this answers **405**; on any non-ok response `load()` returns silently and the panel renders **nothing** | `app/[locale]/(suara)/susun/KonfirmasiPanel.tsx:29-56`; sole export `app/api/documents/route.ts:22`; 405 captured in `/home/ubuntu/repos/e2e/examples/with-next/.e2e/report.json:1091` |
| B6 | The only client calls into the document API are the broken GET (B5) and the PATCH from `KonfirmasiCard`; **no client code calls `POST /api/documents`** — the sole caller is the external e2e harness | `KonfirmasiCard.tsx:39-48`; `/home/ubuntu/repos/e2e/examples/with-next/tests/suara-lapangan.e2e.ts:179` |
| B7 | Unduh/Kirim buttons exist but have **no `onClick`**; they only encode the disabled state and its reason; the only wired control is the WhatsApp share anchor | `KonfirmasiPanel.tsx:97-126` (buttons), `:132-134` (the sole `onClick`, on the share anchor) |
| B8 | The document number is a fixed string: `defaultNomor()` returns `SL/QTN/<date>/001`; `applyGuard` overwrites any model-provided number with `context?.nomor ?? defaultNomor(tanggal)`; no production caller passes `nomor` | `lib/server/guard/rules.ts:44-46` and `:77`; call sites `app/api/documents/route.ts:152,176` pass `{ sessionId }` only |
| B9 | The schema already demands a 3-digit sequence: `"pattern": "^SL/QTN/\\d{4}-…/\\d{3}$"`, "Server-made document number" | `contracts/quotation.schema.json:36-39` |
| B10 | Only `sessions`, `turns`, `usage_meter` tables exist; there is no `documents` table | `db/migrations/0001_sessions_turns.sql`, `0002_usage_meter.sql` |
| B11 | Rate limiting exists as a wrapper (`withRateLimit`) with per-route entries already declared for documents and pdf, but only the ASR route is wrapped; documents and pdf are not | wrapper `lib/server/quota/rate-limit.ts:145-200`; limits `:17-21`; only wrap site `app/api/asr/transcribe/route.ts:130` |
| B12 | Daily quota hard-stop is enforced only in the ASR path; `POST /api/documents` is explicitly marked "DEMO-ONLY: In production, enforce authentication, tenant rate limiting, and quota checks"; Spark tokens are never metered (`tokens: 0` always recorded) | `app/api/documents/route.ts:80-81`; metering `lib/server/asr/transcribe.ts:73-80`; hard-stop helper `lib/server/quota/usage-meter.ts:271-292` |
| B13 | The guard recomputes `jumlah`, `total_nominal`, `terbilang`/`amountInWords` server-side, and PATCH recomputes them again | `lib/server/guard/rules.ts:298-345`; `app/api/documents/[id]/route.ts:175-186` |
| B14 | The Dokumen screen is the static three-step placeholder with no client component | `app/[locale]/dokumen/page.tsx:29-44` |
| B15 | No durable storage location for PDFs exists; `.gitignore` has no `data/` entry | `.gitignore` (full file read; no `data/` rule) |
| B16 | The email-adjacent component `SendPdfEmail.tsx` is a leftover from invoify — unimported, excluded from typechecking/linting per `THIRD-PARTY.md:54-56`; no mail dependency is installed | `app/components/templates/email/SendPdfEmail.tsx:1-20`; `THIRD-PARTY.md` "What this repository no longer uses" |

## Granular requirements

Each requirement is numbered for traceability. "Must" = binding owner decision; "must" without an
owner citation follows from one.

**Flow (owner decision 1)**

- R1. The Susun screen must present exactly one primary action, **"Buat dokumen"**, which creates
  the document server-side via the existing `POST /api/documents` contract (B1). It must send the
  resolved `sessionId` and the session locale; project fields are optional and default server-side
  as today (`app/api/documents/route.ts:66-84`, guard defaults `lib/server/guard/rules.ts:89-109`).
- R2. Pressing "Buat dokumen" must **not** navigate. The user remains on Susun and sees the
  creation result in the confirmation panel.
- R3. After a successful creation the panel must show a **"Lihat dokumen"** action that navigates
  to `/[locale]/dokumen?doc=<document-id>`. This is the only path to the Dokumen screen for a
  document.
- R4. The Dokumen screen must render the PDF of the document named by `?doc=`, embedded in the
  page, with **Unduh** and **Kirim** controls beneath it.
- R5. On creation failure the panel must show a visible, localized error message (EN/ID) with the
  server's error code and a retry action. The current silent `if (!res.ok) return;`
  (`KonfirmasiPanel.tsx:36`) must be removed.

**Corrected client call (owner decision 6)**

- R6. The mount-time `GET /api/documents?sessionId=…` fetch (`KonfirmasiPanel.tsx:33-35`) must be
  **removed**. The panel's data comes exclusively from the responses of the actions it performs:
  the create response (POST) and the confirm/correct responses (PATCH, which already return
  `{document, butuh_konfirmasi, status}` — B3).
- R7. Reconciliation across a page reload is served by one new read endpoint,
  `GET /api/documents/{id}` (see D4), used only when the panel or the Dokumen screen is opened
  with a known document id. Without an id, the panel renders nothing (unchanged from the empty
  state today — no archive exists, owner decision 5).
- R8. The client must never construct or predict a document number; `document.id` (server-issued)
  is the handle used in URLs.

**Storage (owner decision 2)**

- R9. A `documents` table must be added to the existing Postgres database (D2). Every document
  created, confirmed, or corrected must be persisted there; the in-memory document store
  (`lib/server/guard/documentStore.ts`) must be **removed** from all request paths (B2 is
  superseded).
- R10. The rendered PDF must be written to disk before it is served (D3). Serving from the
  in-memory cache alone (B4) is superseded: disk is the source of truth, the cache may remain as a
  render-level accelerator.
- R11. When the same session creates a second document, the server must create a **new, distinct
  document** with its own number, its own PDF, and its own record; the previous document's record
  and PDF remain intact in the database and on disk but are no longer reachable from the UI (no
  archive). "Lihat dokumen" always points at the document just created in that panel session.
- R12. Idempotent re-creation for the same session + same inputs (the current in-memory reuse
  check, `app/api/documents/route.ts:126-145`) must be re-expressed against the database: an
  identical `sessionId` (same turns hash) within the same calendar day returns the existing
  document instead of minting a new number. A deliberately repeated create (new create after the
  document was already served) is R11 and must not reuse the number.

**Numbering (owner decision 3)**

- R13. Format: `SL/QTN/YYYY/NNNN` — calendar year, four-digit sequence, zero-padded. This
  supersedes both the date-scoped `SL/QTN/<date>/001` (`rules.ts:44-46`) and the schema pattern in
  `contracts/quotation.schema.json:36-39`, which must be updated in the same change (K2 contract
  change — the schema is the frozen contract, so the pattern edit ships with this spec's tickets
  and `contracts/README.md` is updated with it).
- R14. The sequence resets each calendar year: the first document of year Y is `NNNN = 0001`.
- R15. The number is assigned **at the moment the document is created** (inside the create
  request that also runs Spark + guard), never at draft, never client-side.
- R16. Numbers are unique and **never reused**, including when the create fails after allocation
  or the transaction rolls back: allocation must commit independently of the document insert (a
  burned number is acceptable; a reused number is not).
- R17. Allocation must be safe under concurrent requests (exact mechanism in D5).
- R18. The number must never be spoken-derived or model-derived: the guard's overwrite of any
  model `nomor` stays, now fed by the allocator (R13 supersedes only the value's shape; the
  server-ownership rule of `contracts/README.md:26` stands).

**Unduh and Kirim (owner decision 4)**

- R19. **Unduh** downloads the PDF from the existing PDF route (`GET /api/documents/{id}/pdf`,
  B4), which already serves `Content-Disposition: attachment`
  (`app/api/pdf/[id]/route.ts:88-93`). The route must refuse with 409 while the document is
  `perlu_konfirmasi` (unchanged, B4).
- R20. **Kirim** sends the PDF by email via SMTP with credentials exclusively in environment
  variables (D6). No credential may appear in code, config files, logs, or error messages (the
  redaction standard of `lib/server/asr/log.ts` applies).
- R21. Kirim must be implemented **last** in the ticket plan (owner decision 4): the document
  flow is complete without it, and Unduh works before any mail configuration exists.
- R22. A successful send marks the document `terkirim` and records the recipient and timestamp;
  the status values become `perlu_konfirmasi` → `siap` → `terkirim` (extending
  `lib/server/guard/types.ts:59`, consistent with `docs/01-ARSITEKTUR.md` §3.4 status flow).

**Hardening (owner decision 7)**

- R23. Request validation on the document routes must use **zod** at the route boundary, replacing
  the hand-written checks (`app/api/documents/route.ts:31-84`, `[id]/route.ts:27-52`). The MVP
  spec D1 already names zod as the invoify validation pattern (repo
  `docs/specs/suara-lapangan-mvp/2026-10-28-suara-lapangan-mvp-spec.md`, D1), and the guard
  documents themselves say it runs "setelah zod" (`docs/01-ARSITEKTUR.md` §3.3) — zod is currently
  absent from `package.json` (verified), so it is added here.
- R24. `POST /api/documents` and the PDF routes must be wrapped in the existing
  `withRateLimit` (30 req/min, same as ASR — the entries already exist at
  `lib/server/quota/rate-limit.ts:18-20`) and must enforce the daily quota hard-stop the same way
  the ASR route does (429 + `X-Quota-Hard-Stop`, `app/api/asr/transcribe/route.ts:109-128`). The
  "DEMO-ONLY" comment at `app/api/documents/route.ts:80-81` is removed when this lands.
- R25. Spark token usage must be metered: token counts from the Responses API reply are recorded
  into `usage_meter` via the existing `recordUsage` (`lib/server/quota/usage-meter.ts:258-261`),
  replacing the constant `tokens: 0` of the document path. The ASR side keeps its existing audio
  metering (`lib/server/asr/transcribe.ts:73-80`).

## User Stories (acceptance)

1. As a mandor, I want to press one button on the Susun screen to create my document, so that I
   don't have to understand what an API is to get my Surat Penawaran.
2. As a mandor, I want to stay on the screen I am on when the document is created, so that I don't
   lose my place if something fails.
3. As a mandor, I want a "Lihat dokumen" action after creation, so that I decide when to look at
   the finished document.
4. As a mandor, I want to see the actual PDF on the Dokumen screen, so that I can check it looks
   like a real firm document before I send it.
5. As a mandor, I want Unduh to give me the PDF file, so that I can keep a copy or send it myself.
6. As a mandor, I want Kirim to email the PDF to my client, so that the document reaches them on
   the channel we already use.
7. As a mandor, I want Unduh and Kirim locked with a visible reason while fields still need
   confirmation, so that an unconfirmed document never reaches a client (current lock logic,
   `KonfirmasiPanel.tsx:59`, `:96-126`, is kept and now acts on a real document).
8. As a mandor, I want a clear error message when creation fails, so that I know to try again
   instead of staring at a silent screen.
9. As a mandor, I want each quotation I create to carry a different document number, so that no
   two of my offers can be confused (fixes B8's fixed `…/001`).
10. As a mandor, I want the document I confirmed yesterday to still exist with the same number
   today, so that my records survive — even though the app only shows me the document I just made.
11. As the product owner, I want documents stored in Postgres and PDFs on disk, so that a server
   restart does not erase client-facing records (fixes B2's "DEMO-ONLY" memory store).
12. As the product owner, I want the numbering to survive a server crash between allocation and
   insert, so that a reused number can never reach two different clients (R16).
13. As the product owner, I want the document and PDF routes rate-limited and quota-checked like
   the ASR route, so that a runaway client cannot burn the daily budget (R24, B11/B12).
14. As the product owner, I want Spark token usage metered, so that the usage report reflects the
   real cost of document creation (R25).
15. As a developer, I want request bodies validated by zod at the route boundary, so that invalid
    input fails with a precise 400 before it reaches the guard or the model.
16. As a tester, I want the document create response to keep the exact envelope
    `{document, butuh_konfirmasi, status}` the e2e harness already asserts
    (`/home/ubuntu/repos/e2e/examples/with-next/tests/suara-lapangan.e2e.ts:179`), so that the
    existing suite keeps passing.
17. As a tester, I want a second "Buat dokumen" press for the same session to produce a distinct
    document and number, so that I can verify R11 and R12 behave as specified.
18. As a client receiving the email, I want the PDF attached and a one-line message, so that I can
    open the offer without logging into anything.

## Implementation Decisions

### D1 — One creation action, one create endpoint, no new pipeline

The interactive workflow is:

```text
Susun (KonfirmasiPanel)                       Server
────────────────────────                       ──────
user resolves cards via PATCH ────────────────▶ PATCH /api/documents/{id}
  (items empty → status "siap")
user presses "Buat dokumen" ─────────────────▶ POST /api/documents {sessionId, locale}
                                               (existing pipeline B1, now zod + rate limit + quota)
◀── 200 {document{id, nomor, …}, butuh_konfirmasi, status}
panel shows result + "Lihat dokumen" (NO auto-nav)
user presses "Lihat dokumen" ────────────────▶ /{locale}/dokumen?doc=<id>
Dokumen screen ──────────────────────────────▶ GET /api/documents/{id}          (new, read-only)
◀── {document, butuh_konfirmasi, status}
                                               GET /api/documents/{id}/pdf      (existing B4)
                                               POST /api/documents/{id}/email   (new, last ticket)
```

`POST /api/documents` keeps its contract (B1) with one addition: the stored/returned document
carries a server-issued `id`. The envelope keys are unchanged (story 16). No second create path
exists; the inline-`turns` test branch of today's POST (`app/api/documents/route.ts:84-89`) is
kept for tests only, as now.

### D2 — Data model (Postgres, migration 0003)

```sql
create table if not exists documents (
    id          uuid primary key default gen_random_uuid(),
    session_id  text not null references sessions (id) on delete cascade,
    locale      text not null check (locale in ('en', 'id')),
    nomor       text not null unique,
    status      text not null default 'perlu_konfirmasi'
                check (status in ('perlu_konfirmasi', 'siap', 'terkirim')),
    data_json   jsonb not null,                       -- the QuotationDocument payload (B1 shape)
    pdf_path    text,                                 -- disk path, null until first render
    sent_to     text,                                 -- email recipient, null until sent
    sent_at     timestamptz,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists document_sequences (
    year        integer primary key,
    last_number integer not null default 0 check (last_number >= 0)
);
```

The document payload stored in `data_json` is the `QuotationDocument` shape the guard already
produces (`lib/server/guard/types.ts:45-57`); `nomor`, `jumlah`, `total_nominal`, `terbilang`
remain server-computed columns of that payload (B13, `contracts/README.md:26`). PATCH moves from
`docStore.get(id)` (`app/api/documents/[id]/route.ts:83-88`) to a DB read-modify-write of
`data_json`, keeping its current field whitelist and recompute behaviour exactly (B3). The
in-memory `InMemoryDocumentStore` and its module (`documentStore.ts`) are deleted; the memory-only
residual is the PDF render cache (see D3), which is an accelerator, not a record.

`documents.status` extends the current two-value type (`types.ts:59`) with `terkirim` (R22);
`perlu_konfirmasi → siap` promotion logic is unchanged from B3.

### D3 — Disk layout for PDFs

- Directory: `PDF_STORAGE_DIR` environment variable, default `./data/pdf`.
- File name: `<yyyy>/<nnnn>.pdf` under that directory — e.g. `data/pdf/2026/0001.pdf` for
  `SL/QTN/2026/0001`. The number is unique per year (R16–R17), so the path is unique without
  extra components.
- Write-once: the first successful render writes the file (atomic write via temp file + rename)
  and stores the path in `documents.pdf_path`. Subsequent requests serve from disk; the in-memory
  cache of today (`app/api/pdf/[id]/route.ts:15,71-77`) may remain keyed by content hash but is no
  longer authoritative.
- If the document is corrected after render (PATCH changes `data_json`), the next PDF request
  detects the changed payload (the route already hashes it, `app/api/pdf/[id]/route.ts:21-22,
  71-77`), re-renders, and **overwrites the same path** — one file per number, always the current
  content of that document.
- `data/` is added to `.gitignore` (currently absent — B15). The directory is created on demand
  by the route; a missing/unwritable directory yields the route's existing 500 `pdf_failure`
  (`app/api/pdf/[id]/route.ts:83-86`) with the cause logged through the redaction-safe logger
  pattern (`lib/server/asr/log.ts`).

### D4 — New read endpoint `GET /api/documents/{id}`

Today the documents routes have exactly `POST` (collection) and `PATCH` (item) — no GET exists
(B5, verified exports). This spec adds `GET /api/documents/{id}` returning the same envelope as
PATCH's 200 (`{document, butuh_konfirmasi, status}` — B3), read-only, with the same 404 for an
unknown id. It serves R7: panel reconciliation after reload and the Dokumen screen's initial
state. It is not a list — there is no collection GET (owner decision 5).

### D5 — Numbering allocator (exact mechanism)

Allocation is a standalone committed transaction, decoupled from the document insert so a rollback
can never resurrect a number (R16):

```sql
-- in its own transaction:
insert into document_sequences (year, last_number)
values ($1, 1)
on conflict (year) do update
    set last_number = document_sequences.last_number + 1
returning last_number;
```

- The `on conflict` upsert takes the row lock under the default write isolation, so two concurrent
  creates serialize on the single row per year: each gets a distinct `last_number` (R17). No
  advisory locks, no application-side counters.
- The number is formatted `SL/QTN/<year>/<nnnn zero-padded to 4>` and written into
  `documents.nomor` (unique constraint as a second line of defence, D2) inside the document
  insert. If that insert fails, the sequence transaction has already committed — the number is
  burned, never reused (R16).
- Year rollover is implicit: a new calendar year's first create hits the insert branch (`0001`),
  so the reset (R14) needs no job and no scheduler.
- The allocator is a pure-ish server function `allocateDocumentNumber(db, year)` — the seam tests
  use (Testing Decisions). The date used for the year is the server's creation date (today's
  `formatDate` basis, `rules.ts:37`), not the document's `tanggal` field, so back-dated documents
  cannot collide across years.
- `defaultNomor()` and the fixed `/001` are deleted (`rules.ts:44-46`); `context?.nomor`
  injection from the route stays for tests (`rules.ts:77`), with the route now passing the
  allocated number for both the Spark path and the fallback path.

### D6 — Email approach (Kirim)

**Nodemailer over SMTP, configured entirely by environment variables.** One route:
`POST /api/documents/{id}/email` with body `{to: string}` (zod-validated, RFC-style email check).

- Requested by R20/R21; the dependency is `nodemailer` (MIT, added to `package.json` +
  `THIRD-PARTY.md` per the licensing rule of `docs/03-GATE-GO-NO-GO.md` / Pre-Flight item on
  licences). No email SDK from a vendor; the leftover `SendPdfEmail.tsx` React template and its
  `@react-email/*` imports are **not** revived (they are dead invoify code — B16).
- Env contract: `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM` (plus optional
  `SMTP_SECURE`). All five required; if any is missing the route answers
  503 `email_not_configured` with the same user-message style as the ASR error table
  (`lib/server/asr/errors.ts`). Credentials never appear in logs — failure logs go through
  `redactSecrets` (`lib/server/asr/log.ts:7-31`), and the SMTP password is added to its scrub
  list.
- Behaviour: read the document, refuse 409 if not `siap`/`terkirim`, read the PDF from disk
  (`pdf_path`), send one message with the PDF attached and a short localized subject/body
  (`Surat Penawaran <nomor>` / `Quotation <nomor>`), then set `status = 'terkirim'`, `sent_to`,
  `sent_at` (R22). Send failure returns a mapped 502 with a user message; the document is
  unchanged so the user can retry.
- Why SMTP/nodemailer over a provider SDK: it keeps the demo deployable to any host without a
  vendor account, needs exactly one dependency, and satisfies "credentials in env, never in code"
  without adding a secrets service — consistent with the MVP spec's minimal-dependency stance
  (its Testing/Notes sections list Vitest as the only new non-runtime dependency, an approach this
  spec follows with nodemailer).
- Scheduled last in the plan (R21).

### D7 — Error handling (client and server)

- Server error contract stays as built: `{error: {code, message}}` bodies with mapped statuses
  (B1's ASR-style table; PATCH's existing 400/404 shapes, `[id]/route.ts:27-52, 79-96`). New
  codes: `not_configured` (503, no DB or no SMTP), `quota_exceeded` (429 + `X-Quota-Hard-Stop`,
  same shape as the ASR route, `app/api/asr/transcribe/route.ts:109-128`), `rate_limited`
  (429 with `Retry-After`, from `withRateLimit`, `lib/server/quota/rate-limit.ts:172-198`).
- Client: `KonfirmasiPanel` and the Dokumen screen map every non-ok response to a visible,
  localized message with a retry affordance (R5). The silent returns at
  `KonfirmasiPanel.tsx:36` and the null-render early exits (`:55-56`) are replaced by explicit
  empty/created/error states; the null-render remains only for "no document created yet" (R7).

## Testing Decisions

Good tests here assert the contract the user or the harness sees — envelopes, statuses, numbers,
files on disk — never internal map contents. Prior art in the repo: the ASR route tests with a
real Postgres behind `ASR_TEST_DATABASE_URL` (`app/api/asr/transcribe/route.test.ts`), the PDF
route tests asserting `%PDF` header / 409 / cache (`app/api/pdf/[id]/route.test.ts`), the guard
fixture suites (`lib/server/guard/documentFromTurns.test.ts`), and the 12-test external e2e
harness (`/home/ubuntu/repos/e2e/examples/with-next/tests/suara-lapangan.e2e.ts`).

Seams, fewest-first, reusing existing ones:

1. **`documentFromTurns()` — unchanged.** All guard/fixture tests keep running untouched; this
   spec does not modify guard rules except the number source (`rules.ts:77`), which the existing
   fixtures already exercise via `context.nomor` injection.
2. **`allocateDocumentNumber()` — new pure-ish seam (the one new seam).** Vitest against the test
   Postgres: first number of a year is `0001` (R14); N concurrent allocations on one connection
   pool yield N distinct numbers (R17); the counter commits after a simulated document-insert
   failure and the burned number is never handed out again (R16); year rollover resets (R14).
3. **Route boundaries with mocked Spark and the test Postgres.** POST: envelope unchanged
   (story 16), `documents` row exists with status per `butuh_konfirmasi`, second identical create
   returns the same document (R12), deliberate re-create mints a new number (R11). PATCH: DB
   persistence of the correction and recompute (B3 unchanged). GET: same envelope as PATCH (D4).
   Validation: zod rejections answer 400 before the model is called (R23). Rate limit: 31st
   request in a minute → 429 with `Retry-After` (mirrors the existing limit test,
   `suara-lapangan.e2e.ts:501`); quota hard-stop after the daily cap → 429 + `X-Quota-Hard-Stop`
   (R24). Token metering: a mocked Spark response carrying a usage object results in
   `usage_meter.tokens` > 0 (R25).
4. **PDF route against disk.** After one GET: `%PDF` header, file exists at `pdf_path` under
   `PDF_STORAGE_DIR` (R10); second GET serves from disk after the memory cache is cleared;
   PATCH then GET re-renders and overwrites the same path (D3); `perlu_konfirmasi` → 409
   (unchanged, B4).
5. **E2E, both suites.** In-repo Playwright: the full chain upload → turns → confirm → create →
   Dokumen renders → PDF downloads (closes the gap noted in the Phase 1 audit: no test ends in a
   PDF download today). External 12-test harness: its POST test keeps passing unchanged (story
   16); the citation test keeps working because the turns endpoints are untouched.
6. **Email (last ticket).** SMTP stubbed (nodemailer's mock transport): attachment present,
   filename `<nomor>.pdf`, status flips to `terkirim` with `sent_to`/`sent_at` (R22); missing env
   → 503 (R20). No live send in CI.

## Out of Scope

Each boundary below is explicit, with its one-line reason:

- **Server-side regional-word flagging** — the UI regex highlighting
  (`app/[locale]/(suara)/susun/TurnCard.tsx:37-43`) is cosmetic; making the guard flag Javanese/
  regional words is a model-behaviour change deserving its own spec.
- **Document archive / list screen** — owner decision 5: only the document just created is
  viewable; a list is a new surface with search, permissions, and retention questions.
- **Multi-user / auth work** — the session token model and the "DEMO-ONLY" auth note
  (`app/api/documents/route.ts:80`) stay as they are; auth is a post-hackathon decision in the
  MVP spec's own out-of-scope list.
- **Deployment** — no hosting, domain, or deploy workflow; explicitly a separate planning thread
  per the owner's standing decision (progress notes, item `no-deploy-yet`).
- **The hardcoded `final: true` turn limitation** — `normalizeTurns` hardcodes `final: true`
  (`lib/server/asr/turns.ts:63-71`) so guard rule 1's non-final branch cannot fire on real Meta
  data; fixing it requires a Meta API behaviour change decision, not a document-pipeline change.
- **The machine-specific Chromium path** — `CHROME_PATH` fallback
  `/home/ubuntu/.cache/ms-playwright/…` (`app/api/pdf/[id]/route.ts:24-26`) stays until deploy
  defines the runtime image; not a document-pipeline concern.
- **The missing `@react-pdf/renderer` fallback** — docs name it a Chromium-unavailable fallback;
  adding a second render engine is out of scope here (render failure keeps answering 500, B4).
- **Creating documents from anywhere but the Susun screen** — no CLI, no Dokumen-screen create
  button, no API-key-driven creation for third parties (R1's single entry point is the product
  decision).

## Further Notes

- **Ticket plan (owner decision 4 fixes email last):**
  1. Migration 0003 + Postgres document store; remove `InMemoryDocumentStore` from all paths
     (R9–R12).
  2. Numbering allocator + wire into POST create; schema pattern update to
     `SL/QTN/YYYY/NNNN` (R13–R18; K2 contract change noted).
  3. PDF to disk + serve-from-disk (R10, D3); PATCH/GET persistence (D4).
  4. Client: "Buat dokumen" + "Lihat dokumen" + Dokumen screen with embedded PDF and Unduh;
     remove the broken GET (R1–R8, R19).
  5. Hardening: zod, rate limit + quota on document/PDF routes, Spark token metering
     (R23–R25).
  6. **Kirim by email — last** (R20–R22, D6).
- **Folder ownership:** per `AGENTS.md` (repo), `app/api/documents/**` and
  `lib/server/guard/**` belong to ticket 05's owner, `app/[locale]/(suara)/**` to ticket 07's,
  `app/api/pdf/**` + `app/components/templates/**` to ticket 08's. Tickets 1–3 above are
  ticket-05-scope, ticket 4 is ticket-07-scope plus a Dokumen-screen addition that needs the
  owner to confirm who owns `app/[locale]/dokumen/**` (today it is outside every listed
  ownership rule), ticket 5 spans 05 (server) and the rate-limit module, ticket 6 is new surface
  under `app/api/documents/**` (05's ownership). This spec does not reassign ownership; flagging
  the gap is all it does.
- **Conflicts with current code that this spec resolves by decision:** the fixed `/001` number
  (B8) and the schema pattern (B9) are superseded by R13; the in-memory store (B2) by R9; the
  silent-405 client behaviour (B5) by R5–R7; the unwrapped/unmetered document routes (B11–B12)
  by R24–R25. Everything else in the pipeline (guard rules, Spark path, PDF template, turns,
  quota internals) is reused as built.
- **Untracked artifact:** this file is intentionally left untracked; committing and pushing
  remain human decisions per `AGENTS.md`.

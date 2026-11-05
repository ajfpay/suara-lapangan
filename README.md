# Suara Lapangan

Speak the job, check every number against your own recording, and issue a
formal document — a Quotation in English or a Surat Penawaran in Indonesian.
Built for foremen and small contractors working in Indonesian and English, on
sites where the signal comes and goes.

This repository is at the skeleton stage: the three screens exist and are
navigable, the two locales work, and the recording, transcription, number
checking and PDF work arrives in the tickets that follow.

## Hackathon provenance

This section records which parts of the repository existed before the
hackathon and which were built during it. It is based on the git history of
this repository. The paragraph above describes the state at `56a112a`
(2026-10-29), not the current state.

### What existed before

The starting point is commit `3859b3c` (2026-08-24), an MIT-licensed fork of
[invoify](https://github.com/al1abb/invoify). It supplied the Next.js 15 App
Router project, React 18, TypeScript, Tailwind CSS, `next-intl`, the Playwright
harness, the `puppeteer-core`/headless-Chromium HTML-to-PDF pipeline, and the
MIT LICENSE. Its invoice form, template gallery and invoice export/send routes
were removed in `56a112a`; none of those are hackathon contributions.
`56a112a` also added THIRD-PARTY.md.

### What was built during the hackathon

The hackathon window covered by this history is 2026-10-29 to 2026-11-05, taken
from commit dates rather than from an event schedule. It begins at `b935f07` /
`56a112a` and ends at `9242239` (merge of PR #46): 122 commits in
`3859b3c..9242239`. The Suara Lapangan skeleton, the three screens, both locales
and everything in the table below were created in that window.

| Area | Commits and merges that prove it |
| --- | --- |
| Voice-to-quotation pipeline | `af98f7b` (native recorder, 16 kHz mono WAV, offline queue), `118cc92` (ASR route and numbered turns), `73a5b00` (one ASR session per recording), `722b692` (#11, frozen quotation schema and fixtures), `c0a6130` (#12, turn-to-document guard and `POST /api/documents`), `6d13523` (#27, Susun screen wired to document creation), `6eecb4d` (Batch 2 fan-in), `4426727` and `1650a94` (#35, DIARIZATION and vocabulary biasing) |
| Review and confirmation flow | `51d67be` (#14, Susun turn review with citation audio slices), `3cf7922` (#19, confirmation cards), `4b94cfb` (patch editing with provenance and structural line operations), `5d82724` (drafts with deferred numbering), `775762c` (approval, atomic numbering, versioning), `b56322f`, `b5b8030`, `e745279`, `abdbb43`, `b27a0fc` (#43) |
| Document numbering and PDF generation | `d8d29ea` (#25, server-side yearly `SL/QTN/YYYY/NNNN` allocator), `dd7f6f2` (#20, quotation PDF template and route), `7668c24` (#26, PDF written to and served from disk), `2b86d9a` (drafts stay drafts on patch), `d91bd7a` (PDF gated on approval), `2946a07` (version lineage in GET), `136c54a` (draft state and version history UI), `855b3f7` (Chromium in the production image) |
| Email path | `987efa8` (#31, send the document PDF by email), `1c4b4e2` (#33, daily send quota and optional recipient allowlist), `a942354` (owner-or-admin authorization on email), `42cf4a9` (refuse to send a draft with 409) |
| Concurrency fix | `2e542ce` (atomic reserve/release/reconcile quota), `06e0a9b` (per-user quota buckets and atomic first-upload claim), `8384884`, `c850948`, `adfc31a`, `bde75ab`, `9242239` (#46, claim-session-owner race), `8befb5f` (dedicated pool client for migration transactions) |
| Test suites | `25928a5` (Vitest unit runner), `ba10acd` (#15, WER evaluation and Gate 1 report), `70546b1` (#30, full-chain e2e with database-level validation), `24a92df` (#32, Postgres-backed route tests in CI), `4ae5cfd` (e2e re-pinned to review/approve), `a80c1bc` (approved-PDF CI smoke test), `8f93059` (migration regression), `66dc8a0`, `1523f39`, `613787c` |

### Meta models and endpoints used

- `muse-voice-transcribe-1.0` at `https://api.meta.ai/v1/asr/transcribe` from
  `lib/server/asr/meta.ts`, in `ENDPOINTING` and `DIARIZATION` modes with a
  16 kHz mono WAV `audio` part. Turn boundaries come from the API.
- `muse-spark-1.3` at `https://api.meta.ai/v1/responses` from
  `lib/server/guard/spark.ts`, for document extraction.
- `wss://api.meta.ai/v1/asr/realtime` appears only in the standalone
  `scripts/asr-realtime.mjs` demo, not in the application runtime.
- PDFs are rendered as HTML and produced with `page.pdf()` in headless Chromium
  via `puppeteer-core` (`lib/server/pdf/storage.ts`), the pipeline inherited
  from the invoify fork.

### Credential source

The intended source of `MODEL_API_KEY` is the Akeyless path
`/workstation/credential/muse`. Using the key stored there currently returns
HTTP 402 `billing_not_configured` from the Meta API, so local runs use a
separate key from an untracked file: `.env.local`, mode 600, excluded by
`.gitignore`. The key is not committed, not printed in logs, and not in this
README. Akeyless held one Meta/Muse candidate path; no other Akeyless path was
used, and the local key is a separate credential, not the Akeyless value.

The key currently active in `.env.local` is the v2 candidate, copied from
`credential-musev2.md` in `/home/ubuntu/repos/collisium/.credential/` (the
directory is sometimes spelled `consilium`): it returns HTTP 200 on real
`muse-voice-transcribe-1.0` calls with a 20 s, 16 kHz mono WAV sample and the
app's 50 keywords, and the app's own `POST /api/asr/transcribe` returns turns
from it.

### Vocabulary biasing

The official [speech-to-text documentation](https://dev.meta.ai/docs/speech-to-text)
places `keywords` and `languageBias` in the multipart `request` part of
transcribe and states that keywords bias recognition but do not guarantee an
exact spelling. Vocabulary biasing was added to the app in `4426727` / PR #35.
The local branch commit `0bd82d9` keeps the same request path and parameters
and derives the keyword list from the app's own data: every `satuan` in
`contracts/quotation.schema.json` (with spoken forms from `SPOKEN_UNITS`),
materials and field terms counted across `fixtures/transcripts/*.json`, and
significant terms from the session's recorded turns.
`lib/server/asr/transcribe.test.ts` asserts that these terms are present in the
outgoing `request.keywords` when a session has vocabulary.

The live endpoint was checked with one 20 s, 16 kHz mono WAV sample. The
endpoint returned 200 and transcribed with and without vocabulary biasing. The
biased runs consistently resolved the unit phrase while the unbiased runs
produced unrelated words. Run-to-run variance, dropped leading words and the
absence of a ground-truth transcript mean no accuracy claim can be made. It is
a reproducible change in output, not a verified accuracy gain; no ground truth
was checked.

## The three steps

| Step | Address | What happens there |
| --- | --- | --- |
| Rekam | `/en`, `/id` | Record the job out loud. |
| Susun | `/en/susun`, `/id/susun` | Review what was said, turn by turn, with the numbers it contains. |
| Dokumen | `/en/dokumen`, `/id/dokumen` | Issue the document. |

Only `en` and `id` are shipped, and English is the default. Any other locale
prefix, and any address that is not one of the three steps, answers 404.

## Running it

Requires Node 20 or newer.

```bash
npm ci
npm run dev        # http://localhost:3000
```

| Script | What it does |
| --- | --- |
| `npm run dev` | Development server. |
| `npm run build` / `npm start` | Production build and serve. |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run lint` | ESLint. |
| `npm run test:e2e` | Playwright smoke suite. Builds and serves the app first. |
| `npm run check:third-party` | Verifies every installed package is listed in THIRD-PARTY.md. |
| `npm run icons` | Re-renders the app icons from `public/assets/img/suara-lapangan-mark.svg`. |

The e2e suite runs two projects — desktop 1440x900 and mobile 375x812 — and
needs no microphone and no network: it drives the built app over HTTP.

## Stack

Next.js 15 (App Router) · React 18 · TypeScript · Tailwind CSS · `next-intl`
for the two locales. The document pipeline renders HTML through headless
Chromium, and `puppeteer-core` is kept out of the server bundle for it.

## Licence

MIT. This application was forked from the MIT-licensed
[invoify](https://github.com/al1abb/invoify); its copyright notice is kept
verbatim in [`LICENSE`](LICENSE) and served at `/LICENSE`, as the licence
requires. Every dependency, with its version and licence, is listed in
[`THIRD-PARTY.md`](THIRD-PARTY.md).

The invoice flow — the invoice form, the template gallery, the e-invoice XML
export and the email sender — was removed in the first ticket.
`app/components/templates/**` is still present but unimported and excluded from
typechecking and linting; it belongs to the ticket that builds the Quotation /
Surat Penawaran template.

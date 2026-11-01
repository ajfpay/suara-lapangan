# SPEC — Meta ASR feature usage (DIARIZATION, vocabulary bias, language hint, progress)

- **Date:** 1 Nov 2026 · **Status:** DRAFT — awaiting owner approval
- **Decision owner:** Product Owner (features are additive; default stays ENDPOINTING record-then-transcribe)
- **Scope:** `lib/server/asr/**`, `app/api/asr/**`, `db/**`, recorder/UI copy in `app/[locale]/(suara)/rekam/**` + `lib/client/use-recorder.ts` + `i18n/locales/{en,id}.json`
- **Authoritative sources:** Meta Muse Voice Transcribe cookbook (`06_muse_voice`, verified against dev.meta.ai); current repo state at `eb7dabd` (`lib/server/asr/meta.ts`, `lib/server/asr/turns.ts`, `app/api/asr/transcribe/route.ts`, `lib/server/asr/transcribe.ts`)
- **Constraint:** the existing susun → dokumen flow must not break; per-turn `startMs`/`endMs` must be preserved; labels in en and id; no LLM provider changes; no OpenAI-compatible speech provider.

---

## Problem Statement

Today `lib/server/asr/meta.ts` uploads one recording to `POST https://api.meta.ai/v1/asr/transcribe` with `mode: ENDPOINTING` and returns turns. The Meta API offers more that the product should use:

1. **DIARIZATION mode** — automatic speaker detection/attribution (labels A, B) for multi-speaker job-site conversations.
2. **Vocabulary biasing** — `keywords` for product names / people / places / acronyms / domain terms. Today keywords are a hardcoded `KEYWORDS` const; the project already has a richer domain vocabulary in `contracts/quotation.schema.json` (`satuan` enum, `jenis`, field names).
3. **Language hint** — `languageBias` (25 languages, code-switching). Today it is hardcoded by locale (en → ["English"], id → ["Indonesian"]).
4. **Progress / partial feedback** — long recordings take up to 10 min to decode; the user sees only a spinner. The API has realtime (WebSocket) partial + audio-progress events, and speech-turn detection events.

## Facts (verified from cookbook, not guesses)

- **Two endpoints**:
  - `POST https://api.meta.ai/v1/asr/transcribe` (multipart, Bearer header). Request: `request` JSON part with `mode`, `model`, `audioEncoding: "WAV"`, optional `keywords` (list), optional `languageBias` (list). Response: `{sessionId, transcript, audioDurationMs, turns: [{startMs, endMs, transcript, speaker?}]}`.
  - `wss://api.meta.ai/v1/asr/realtime` (WebSocket; credential **in handshake JSON** `{authorization: {accessToken}}`, not a header). Modes fixed at handshake; binary PCM frames (`PCM_16KHZ`/`PCM_24KHZ`); events: `session`, `speechStart`, partials (cumulative), `speaker`, `speechEnd`, `speechComplete`, `error`; end with `{"type":"endStream"}` JSON frame.
- **Modes:** `PUSH_TO_TALK` (default; caller delimits turn), `ENDPOINTING` (model detects boundaries), `DIARIZATION` (endpointing + speaker labels). Not every model serves every mode; a rejected mode is an error before audio is accepted.
- **Response shapes:** `turns[]` present only in speech modes; `speaker` present only in DIARIZATION, value is bare letter `"A"` / `"B"`; turn-level timestamps only. **No word-level timestamps, no confidence scores, no sound-event/emotion detection, no transcript reformatting** — do not design around them.
- **Limits:** one-shot capped 10 min / 32 MB; realtime capped 60 min, pacing required (audio must arrive ~real-time), close codes 1008/1011/1013.

## Current state (evidence)

| #   | Current behaviour                                                                                                                       | Evidence                                                                                                     |
| --- | --------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| B1  | `transcribeWithMeta` hardcodes `mode: "ENDPOINTING"`, `languageBias` from locale const, `keywords` from static `KEYWORDS` const (en/id) | `lib/server/asr/meta.ts:40-62`                                                                               |
| B2  | Response type `MetaTranscription` / `MetaTurn` has no `speaker` field                                                                   | `lib/server/asr/turns.ts`                                                                                    |
| B3  | `normalizeTurns` drops speaker labels                                                                                                   | `lib/server/asr/turns.ts:58-104`                                                                             |
| B4  | Route uploads single `audio` part, `locale`, `sessionId`; returns `{sessionId, turns}`                                                  | `app/api/asr/transcribe/route.ts`                                                                            |
| B5  | `turns` table has no `speaker` column; `sessions` stores transcript + audio duration                                                    | `db/migrations/0001_sessions_turns.sql`                                                                      |
| B6  | Recorder ends: WAV convert → `RecordQueue` → `processQueue()` → POST; UI shows spinner while processing                                 | `lib/client/use-recorder.ts`, `lib/client/record-queue.ts`, `app/[locale]/(suara)/rekam/RecorderControl.tsx` |
| B7  | Vocabulary exists in `contracts/quotation.schema.json`: `satuan` enum (15 units), `jenis`, field names                                  | `contracts/quotation.schema.json`                                                                            |
| B8  | Meta's `keywords` and `languageBias` are lists; partials are cumulative on realtime                                                     | cookbook `utils.py`, `01_voice_api_fundamentals/README.md`                                                   |

## Design

### D1. One-shot endpoint: mode selection, dynamic vocabulary, language hint

`transcribeWithMeta` stays the one-shot path. Add to `TranscribeOptions`:

- `mode: "ENDPOINTING" | "DIARIZATION"` (default `ENDPOINTING` — frozen K3 contract for the susun flow).
- `keywords: string[]` — derived from a server-side `buildKeywords(locale, turns?)` that merges:
  - domain vocabulary from `contracts/quotation.schema.json` (`satuan` enum values — `m2`, `sak`, `batang`, `titik`, `borongan`, … in the locale's spoken form where it differs; acronyms like `m2`);
  - project-specific terms the user has already spoken in the session (tokens from prior turns, filtrable — e.g. client name, project name, place names),
  - a small curated safety list per locale (keep current `KEYWORDS` as the baseline for en/id).
- `languageBias: string[]` — keep locale-driven (`en` → `["English"]`, `id` → `["Indonesian"]`, and **always include both** so code-switching en↔id is biased — the product explicitly supports both languages in one recording).

Response parsing: `MetaTurn` gains `speaker?: string | null`; `Turn` (K3) gains `speaker?: string | null`. `normalizeTurns` passes speaker through, falling back to `null`. **`turn_id` numbering, `startMs`/`endMs` clamping, and non-overlap rules are unchanged** — the document layer's contract is untouched.

### D2. DIARIZATION support

- Route accepts an optional `mode` form field (`"ENDPOINTING" | "DIARIZATION"`), validated against the same enum; absent → ENDPOINTING (no flow change).
- `meta.ts` passes `mode` through.
- `turns.ts` surfaces `speaker`.
- Migration `0005_asr_speaker.sql` adds `speaker text` (nullable) to `turns`; store round-trips it. _(Note: renamed from 0004 to 0005 because `0004_email_sends.sql` already exists in repo)._
- Susun UI: TurnCard shows a speaker badge (A/B) only when a speaker label exists; labels remain en/id via i18n.

### D3. Realtime WebSocket (progressive)

**Constraint discovered:** Next.js App Router route handlers cannot accept WebSocket upgrades; that requires a custom server. The current flow is Next-only, so a full realtime proxy is out of scope for this ticket without destabilising the flow. **Decision: ship the realtime client as a standalone Node script + docs, not wired into the browser flow.** It lives at `scripts/asr-realtime.mjs` (Node ≥ 20, no new deps — uses global `WebSocket`). It:

- connects to `wss://api.meta.ai/v1/asr/realtime`, authenticates in the handshake JSON;
- streams a WAV file as binary `PCM_16KHZ` frames, paced at real time;
- prints cumulative partials in place, then final turns (with speaker labels in DIARIZATION);
- handles close codes 1008/1011/1013 with readable messages.

This gives the owner a tested, runnable demonstration of partial/progress + DIARIZATION over realtime without touching the app flow. The browser flow keeps record-then-transcribe (which also satisfies progress: the UI copy for long processing is improved in D4).

### D4. Progress feedback on long uploads

Without realtime in the browser, the honest progress signal is the transcript/audio duration from the response. Add:

- `use-recorder.ts`: expose `processingStartedAt`; when status is `processing`, render an elapsed-seconds counter (reuses existing `duration` state; no new deps).
- i18n copy en/id: `rekam.processing` becomes dynamic: `"Memproses audio… {seconds} dtk"` / `"Processing audio… {seconds}s"`; add `rekam.processingHint` ("Long recordings take a while — you can leave this tab open." / "Rekaman panjang membutuhkan waktu — biarkan tab ini terbuka.").

### D5. Vocabulary-update surface (small)

`lib/server/asr/vocabulary.ts` exports `buildKeywords(locale, spokenTerms?)`; `KEYWORDS` moves there. The route computes keywords from the session's _previous_ turns (the store's `findSession`) — so session terms reach Meta only on a same-id re-upload (or manual sessionId entry), not on an ordinary second recording (since `lib/client/use-recorder.ts` mints a fresh sessionId per recording). Pure function; unit-tested.

## Non-goals

- Word-level timestamps, confidence scores, sound-event/emotion detection, transcript reformatting (don't exist in the API).
- Changing the K3 turn contract shape (document guard depends on it).
- OpenAI-compatible speech provider (parallel ticket owns provider settings); no LLM provider layer changes.
- Tying realtime into the Next.js browser flow (requires a custom server; out of scope here — D3 provides the script + docs).

## Files

| Area   | Files                                                                                                                                                                     |
| ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec   | `docs/specs/meta-asr-features/2026-11-01-meta-asr-features-spec.md`                                                                                                       |
| Lib    | `lib/server/asr/meta.ts`, `lib/server/asr/turns.ts`, `lib/server/asr/vocabulary.ts` (new), `lib/server/asr/transcribe.ts`                                                 |
| Route  | `app/api/asr/transcribe/route.ts`, `app/api/asr/transcribe/route.test.ts`                                                                                                 |
| DB     | `db/migrations/0005_asr_speaker.sql` (new), `lib/server/db/store.ts`, `lib/server/db/store.test.ts`                                                                       |
| UI     | `app/[locale]/(suara)/rekam/RecorderControl.tsx`, `lib/client/use-recorder.ts`, `i18n/locales/en.json`, `i18n/locales/id.json`, `app/[locale]/(suara)/susun/TurnCard.tsx` |
| Script | `scripts/asr-realtime.mjs` (new)                                                                                                                                          |
| Docs   | `docs/specs/meta-asr-features/2026-11-01-meta-asr-features-spec.md`                                                                                                       |

## Gates (must pass)

1. `npm run typecheck`
2. `npm run lint`
3. `npm run test:contracts`
4. `npm test` (vitest, with `ASR_TEST_DATABASE_URL` set for the Postgres-backed suite)
5. `npm run test:e2e` with `CHROME_PATH` set (Playwright)
6. `npm run check:third-party` (no new deps expected; if one is added, update THIRD-PARTY.md)

## Open questions for owner

- Q1. Should the Susun screen default to DIARIZATION when the session was recorded as multi-speaker? (Default stays ENDPOINTING in this spec.)
- Q2. Is the realtime script (D3) acceptable as the progress demonstration, or is a custom Next server a future ticket?

# 07: Meta ASR features — DIARIZATION, vocabulary bias, en+id hint, progress, realtime script

**What to build:** extend the speech layer (resuming `agent/03b-meta-features`, worktree `/home/ubuntu/repos/suara-lapangan-w03b-meta-features`, 21 files already touched): DIARIZATION mode with speaker labels (A/B), vocabulary biasing derived from `contracts/quotation.schema.json` plus terms already spoken in the session via `buildKeywords`, an en+id language hint (both languages always included), progress feedback on long uploads, and a standalone realtime WebSocket client script (`scripts/asr-realtime.mjs`) plus docs. Turn-level timestamps only; no word-level timestamps. The browser flow stays record-then-transcribe.

**Blocked by:** None (can start immediately; resume branch `agent/03b-meta-features`)

**Status:** ready-for-agent

- [ ] `transcribeWithMeta` accepts `mode` (`ENDPOINTING` | `DIARIZATION`) and passes it through
- [ ] `MetaTurn` and `Turn` gain nullable `speaker`; `normalizeTurns` passes it through
- [ ] Migration `0005_asr_speaker.sql` adds `speaker text` to `turns`; store round-trips it
- [ ] `lib/server/asr/vocabulary.ts` exports `buildKeywords(locale, spokenTerms?)`; `KEYWORDS` moved there
- [ ] Route computes keywords from the session's previous turns
- [ ] `languageBias` always includes both English and Indonesian
- [ ] Susun TurnCard shows a speaker badge only when a speaker label exists (en/id)
- [ ] Recorder UI shows an elapsed-seconds counter while processing, with updated en/id copy
- [ ] `scripts/asr-realtime.mjs` connects, authenticates in handshake JSON, streams PCM, prints partials and final turns, handles close codes 1008/1011/1013
- [ ] `npm run typecheck`, `npm run lint`, `npm test` (with `ASR_TEST_DATABASE_URL`) green

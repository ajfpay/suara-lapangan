# SPEC — Phase 3: Auth, Admin Dashboard, Provider Settings, Full Meta Model API, Deployment

- **Date:** 1 Nov 2026 · **Status:** APPROVED — Gate 1, Gate 2, Gate 3 approved by the owner on 1 Nov 2026; ticket 08 remains blocked pending written approval for the public repository and the deployment
- **Decision owner:** Product Owner (decisions recorded in the orchestration thread, 1 Nov 2026)
- **Scope:** customer login, an admin dashboard at `/admin`, configurable LLM providers, full use of Meta's Model API, the Meta ASR feature set (DIARIZATION, vocabulary biasing, en+id language hint, progress feedback, realtime WebSocket client), and the public-repo + live-deployment work needed for the Meta Global AI Developer Hackathon (submission deadline Wed 4 Nov 2026, 9:00 PM ET / Thu 5 Nov 2026, 09:00 WIB).
- **Authoritative sources:** `docs/specs/suara-lapangan-mvp/2026-10-28-suara-lapangan-mvp-spec.md` (D1–D12, still binding where not superseded); `docs/specs/document-pipeline/2026-10-31-document-pipeline-spec.md`; `docs/specs/meta-asr-features/2026-11-01-meta-asr-features-spec.md` (folded in here); `AGENTS.md`; `contracts/quotation.schema.json`; the Meta Model API cookbook at `.scratch/suara-lapangan-starters/meta-model-cookbook`.
- **Paused work to resume, not redo:** branch `agent/11-auth-admin` (worktree `/home/ubuntu/repos/suara-lapangan-w11-auth-admin`) — Better Auth tables, migrations 0005_auth_tables.sql and 0006_documents_user_id.sql, config, seed-admin command, quota changes, plus the document store; branch `agent/03b-meta-features` (worktree `/home/ubuntu/repos/suara-lapangan-w03b-meta-features`) — 21 files touched (meta.ts, turns.ts, vocabulary.ts, route, store, migration 0005_asr_speaker.sql, UI progress copy, realtime script, fixtures); branch `agent/12-llm-provider-config` (worktree `/home/ubuntu/repos/suara-lapangan-w12-llm-provider`) — no changes yet, pending.
- **All file:line citations refer to `main` `eb7dabd`** (and the paused branches where noted) and describe current behaviour.

## Problem Statement

Suara Lapangan today is a single-tenant, unauthenticated tool: anyone who opens the URL can record, transcribe and generate a quotation, and there is no owner, no history, no admin view and no cost control beyond a single global daily cap. The model layer is hard-wired to one Meta endpoint (`muse-spark-1.3` via the Responses API with `text.format`), the speech layer is hard-wired to `ENDPOINTING` with a static keyword list, and the repository is private with no live deployment — so the hackathon judges cannot even open it.

The product's promise for the hackathon is a hosted, multi-user quotation tool that (a) lets a customer log in, record a job, and find their own documents again; (b) gives the owner an admin view of users, documents and daily cost with a per-user cost cap; (c) lets the admin point the app at any OpenAI-compatible model provider without touching code; (d) exercises the breadth of Meta's Model API — not just one Responses call; and (e) ships publicly and live before the deadline.

## Solution

Add four capability areas on top of the existing susun → dokumen → PDF → kirim flow, without breaking it:

1. **Auth (Better Auth).** Users live in the app's own Postgres, raw `pg`, no ORM. Google sign-in plus email and password. Personal accounts only. Open registration with email confirmation required. Rekam, Susun and Dokumen require login; the public landing pages stay open. Existing ownerless data stays as it is and is visible to admins only. The dashboard lives at `/admin` and is in Indonesian. The first admin is created by a server command (`scripts/seed-admin.mjs`, already drafted on `agent/11-auth-admin`), not through the UI. Auth tables are prefixed `auth_` because `sessions` already means recording sessions. "Login as user" is out of scope.

2. **Customer history ("Dokumen saya").** A simple list where a customer opens their own documents. Documents gain a nullable `user_id` (migration `0006_documents_user_id.sql`, already drafted) so ownership can be recorded at creation without migrating legacy rows.

3. **Admin dashboard (`/admin`, Indonesian).** User list, enable/disable a user, all documents, usage and daily cost, per-user cost limit. Built on the existing `usage_meter` table plus the auth user table.

4. **Configurable LLM providers.** Admin-editable settings: Meta Muse (built in, always available, the default) and any OpenAI-compatible provider (base URL + API key + model). Keys encrypted at rest, masked in the UI, with a test-connection button. A provider row drives which endpoint and credentials the model client uses.

5. **Full Meta Model API coverage.** One model client module (`lib/server/model/**`) that can call all three protocols — Responses, Chat Completions and the Anthropic-shaped Messages API — with structured output (`text.format` on Responses, `response_format` on Chat Completions, recursive schemas rejected by the server), `reasoning_effort` (Muse Spark and Muse Wonder reject `"none"`; `"max"` is not available on the `-contributor` variants; the Responses API nests it as `reasoning.effort`), prompt caching (automatic prefix caching; cached tokens reported at `usage.input_tokens_details.cached_tokens` or `usage.prompt_tokens_details.cached_tokens` — the cost meter must count them), token counting (`POST /v1/responses/input_tokens`), file uploads, streaming, tool calling and tool search, search grounding, image understanding, image generation with Muse Image, video understanding, media segmentation with SAM 3.1, and speech to text through both endpoints (`POST /v1/asr/transcribe` and the realtime WebSocket `wss://api.meta.ai/v1/asr/realtime`) with the `PUSH_TO_TALK`, `ENDPOINTING` and `DIARIZATION` modes, language biasing, vocabulary biasing, speaker labels, partial transcripts and progress events; turn-level timestamps only, no word-level timestamps.

6. **OpenAI-compatible provider.** Chat and structured output. Speech through it is optional and must never break the Meta path.

7. **Meta ASR feature set (folded in from the draft spec).** DIARIZATION mode, vocabulary biasing derived from `contracts/quotation.schema.json` (and from terms already spoken in the session), an en+id language hint (both languages always included so code-switching is biased), progress feedback on long uploads, and a standalone realtime WebSocket client script (`scripts/asr-realtime.mjs`) plus docs — not wired into the browser flow, because Next.js App Router route handlers cannot accept WebSocket upgrades.

8. **Deployment.** Public repository plus a live deployment the judges can open. No deployment exists yet; this is its own ticket and requires the owner's written approval to flip the repo public.

## User Stories

1. As a new customer, I want to register with email and password, so that I can use the app.
2. As a new customer, I want to sign in with Google, so that I do not have to remember another password.
3. As a new customer, I want to confirm my email before I can use the app, so that accounts are real.
4. As a returning customer, I want to log in and be taken back to where I was, so that the flow is uninterrupted.
5. As a logged-out visitor, I want to browse the landing pages, so that I can learn about the product before signing up.
6. As a logged-out visitor, I want to be redirected to login when I try to record, so that protected data stays private.
7. As a customer, I want to record a job, review turns and confirm numbers, so that I get a quotation (unchanged flow).
8. As a customer, I want a "Dokumen saya" page listing my own documents, so that I can reopen them later.
9. As a customer, I want to open one of my documents and download or send it, so that I can share it with a client.
10. As an admin, I want a `/admin` dashboard in Indonesian, so that I can operate the product.
11. As an admin, I want to list users and enable or disable them, so that I can control access.
12. As an admin, I want to see all documents, so that I can support customers.
13. As an admin, I want to see usage and daily cost, so that I can watch spend.
14. As an admin, I want to set a per-user cost limit, so that one user cannot exhaust the budget.
15. As an admin, I want to configure LLM providers, so that I can switch models without a deploy.
16. As an admin, I want Meta Muse to be the built-in default that is always available, so that the app works out of the box.
17. As an admin, I want to add an OpenAI-compatible provider (base URL, API key, model), so that I can use another model.
18. As an admin, I want keys masked in the UI and encrypted at rest, so that secrets are not leaked.
19. As an admin, I want a test-connection button, so that I know a provider works before relying on it.
20. As a developer, I want one model client that speaks all three Meta protocols, so that features are not duplicated.
21. As a developer, I want structured output with JSON schema, so that extraction stays deterministic.
22. As a developer, I want recursive schemas rejected by the server, so that I do not ship a broken call.
23. As a developer, I want `reasoning_effort` control, so that I can trade cost for quality.
24. As a developer, I want prompt caching to reduce cost, so that repeat prefixes are cheap.
25. As a developer, I want the cost meter to count cached tokens, so that spend is accurate.
26. As a developer, I want token counting before a call, so that I can size prompts.
27. As a developer, I want streaming, so that long answers feel responsive.
28. As a developer, I want tool calling and tool search, so that the model can act.
29. As a developer, I want search grounding, so that answers cite live sources.
30. As a developer, I want image understanding, so that photos of jobs can be analysed.
31. As a developer, I want image generation with Muse Image, so that I can produce visuals.
32. As a developer, I want video understanding, so that site footage can be analysed.
33. As a developer, I want media segmentation with SAM 3.1, so that regions of an image can be isolated.
34. As a developer, I want speech to text through both Meta endpoints, so that I can choose batch or realtime.
35. As a developer, I want `PUSH_TO_TALK`, `ENDPOINTING` and `DIARIZATION` modes, so that I can match the recording style.
36. As a developer, I want language and vocabulary biasing, so that site jargon is recognised.
37. As a developer, I want speaker labels and partial transcripts, so that multi-speaker jobs are attributed.
38. As a developer, I want progress events, so that long uploads do not look stuck.
39. As a developer, I want turn-level timestamps only (no word-level), so that the contract stays honest.
40. As a developer, I want the OpenAI-compatible provider to cover chat and structured output, so that I can swap providers.
41. As a developer, I want speech through the OpenAI-compatible provider to be optional and never break the Meta path, so that provider choice is safe.
42. As a developer, I want a seed-admin command, so that the first admin is created out of band.
43. As the owner, I want the repo public and a live deployment, so that judges can open it.

## Implementation Decisions

- **Auth library:** Better Auth, users in the app's own Postgres via raw `pg` (no ORM). Tables prefixed `auth_`. Google + email/password. Open registration, email confirmation required. Personal accounts only.
- **Protected routes:** Rekam, Susun, Dokumen require login; public landing pages open. Enforced in middleware alongside the existing next-intl locale middleware.
- **Data ownership:** documents gain nullable `user_id` (migration 0006, already drafted). New documents record the creator; legacy rows stay null and are visible to admins only.
- **Admin gate:** role column on the auth user (or a separate admin flag) checked server-side for `/admin` and admin APIs. First admin via `scripts/seed-admin.mjs`.
- **Provider storage:** a `providers` table (id, kind `meta` | `openai_compat`, base_url, encrypted_api_key, model, enabled, is_default, created_at). Meta Muse is a built-in row that cannot be deleted and is always available. Keys encrypted at rest with a server secret (env), masked in API responses.
- **Model client:** `lib/server/model/client.ts` with methods per protocol and feature. It takes a resolved provider (Meta built-in or configured OpenAI-compatible) and never hard-codes `MODEL_API_KEY` for the Meta path's defaults beyond the built-in provider row. Structured output uses JSON schema; recursive schemas are rejected client-side before the call. `reasoning_effort` is validated against the model's allowed values (Muse Spark/Wonder reject `"none"`; `"max"` not on `-contributor` variants) and placed at `reasoning.effort` for the Responses API. Prompt caching is automatic prefix caching; the client reads cached tokens from `usage.input_tokens_details.cached_tokens` (Responses) or `usage.prompt_tokens_details.cached_tokens` (Chat Completions) and reports them to the cost meter. Token counting uses `POST /v1/responses/input_tokens`.
- **Cost meter:** extend `usage_meter` to count cached tokens distinctly and to support per-user caps. The hard-stop check becomes per-user (default user stays supported for legacy rows).
- **Meta ASR:** `transcribeWithMeta` gains `mode` (`ENDPOINTING` | `DIARIZATION`), dynamic `keywords` from `buildKeywords(locale, spokenTerms?)`, and `languageBias` always including both English and Indonesian. `MetaTurn` and `Turn` gain nullable `speaker`. Migration `0005_asr_speaker.sql` (already drafted, renamed from 0004) adds `speaker text`. `normalizeTurns` passes speaker through. Vocabulary lives in `lib/server/asr/vocabulary.ts`. Progress feedback is an elapsed-seconds counter in the recorder UI. The realtime client is a standalone Node script (`scripts/asr-realtime.mjs`) using the global `WebSocket`, not wired into Next.js.
- **Deployment:** separate ticket; requires owner approval to make the repo public and to choose a host. Infra prep (Dockerfile, CI, env example) can be done in parallel, but the public flip is a human action.

## Testing Decisions

- Tests verify external behaviour through public interfaces: auth endpoints, protected-route redirects, admin APIs, provider CRUD + test-connection, model client methods, ASR modes and speaker labels, and the existing susun → dokumen → PDF → kirim flow (must stay green).
- Prior art: `app/api/asr/transcribe/route.test.ts`, `app/api/documents/route.test.ts`, `lib/server/asr/meta.test.ts`, `lib/server/guard/guard.test.ts`, `lib/server/db/store.test.ts`.
- The model client gets unit tests with a mocked fetch (no live API in CI), covering schema rejection, reasoning validation, cached-token parsing and the three protocols' request shapes.
- The ASR feature set keeps the existing Postgres-backed test suite (`ASR_TEST_DATABASE_URL`).

## Out of Scope

- Teams and organisations.
- "Login as user" (impersonation).
- Replacing Meta as the speech provider.
- OpenAI-compatible speech provider (optional, never breaks Meta).
- Word-level timestamps, confidence scores, sound-event/emotion detection, transcript reformatting (do not exist in the Meta API).
- A custom Next.js server for realtime WebSocket in the browser (out of scope; the standalone script covers it).
- Anything that breaks the existing susun → dokumen → PDF → kirim flow.
- Auto-merge or direct pushes to `main`.

## Further Notes

- The three paused threads hold uncommitted work that is treated as a starting point to be re-scoped into tickets, not as finished deliverables. Their branches/worktrees are named per ticket in the topology.
- The provider-settings thread has not reported its worktree; its entry is marked pending in the topology and will be filled in once the owner passes it.
- Cost metering must count cached tokens from both reporting locations (`usage.input_tokens_details.cached_tokens` and `usage.prompt_tokens_details.cached_tokens`).

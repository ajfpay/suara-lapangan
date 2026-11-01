# 04: Meta Model API client — three protocols, structured output, reasoning, caching, token counting

**What to build:** a single model client module (`lib/server/model/**`) that speaks all three Meta protocols (Responses, Chat Completions, Anthropic-shaped Messages API), with structured output (`text.format` on Responses, `response_format` on Chat Completions), recursive-schema rejection before the call, `reasoning_effort` validation and placement (`reasoning.effort` on Responses; Muse Spark/Wonder reject `"none"`; `"max"` not on `-contributor` variants), automatic prompt caching with cached-token parsing from both reporting locations, and token counting via `POST /v1/responses/input_tokens`. The existing Spark quotation path is refactored to use it without behaviour change.

**Blocked by:** None (can start immediately; uses the built-in Meta Muse provider)

**Status:** ready-for-agent

**Owner decision (recorded):** the documents route must preserve both branches — fallback to `documentFromTurns` when `MODEL_API_KEY` is unset, and fallback on `upstream_unreachable`/`schema_rejected` — while provider configuration drives which endpoint/credentials are used.

**Meta facts (verified, pinned):**
- Responses takes `text.format` plus `reasoning.effort`.
- Chat Completions takes `response_format` plus a top-level `reasoning_effort`.
- `reasoning_effort` `"none"` is a 400 on Muse Wonder and Spark.
- `"max"` is unavailable on `muse-spark-1.3-contributor`.
- Cached tokens arrive at `usage.input_tokens_details.cached_tokens` (Responses) or `usage.prompt_tokens_details.cached_tokens` (Chat Completions).

**Findings from the paused provider thread:**
- The cost meter overstates: cached tokens are read nowhere, and the documents route meters a flat `$0.005` per document. The client must read cached tokens from both reporting locations and feed them to the cost meter.
- `redactSecrets` in `lib/server/asr/log.ts` only scrubs `MODEL_API_KEY` and `SMTP_PASS`; provider API keys need their own scrubbing path.

- [ ] Client methods for Responses, Chat Completions and Messages API request shapes
- [ ] Structured output accepts a JSON schema and serialises it per protocol
- [ ] Recursive schemas are rejected client-side with a clear error before any network call
- [ ] `reasoning_effort` validated against model-allowed values and placed correctly per protocol
- [ ] Cached tokens parsed from `usage.input_tokens_details.cached_tokens` (Responses) and `usage.prompt_tokens_details.cached_tokens` (Chat Completions)
- [ ] Token counting method calls `POST /v1/responses/input_tokens`
- [ ] Cost meter receives cached-token counts; flat `$0.005` replaced by token-derived or provider-derived cost where available
- [ ] Spark quotation path uses the client with no behaviour change; existing tests green
- [ ] Unit tests with mocked fetch cover schema rejection, reasoning validation, cached-token parsing and request shapes
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green

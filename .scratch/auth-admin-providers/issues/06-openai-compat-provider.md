# 06: OpenAI-compatible provider — chat + structured output

**What to build:** an OpenAI-compatible provider implementation that covers chat and structured output, wired through the provider settings from ticket 03 and the model client from ticket 04. Speech through it is optional and must never break the Meta path: if the provider lacks speech, the app falls back to Meta ASR. Resume branch `agent/12-llm-provider-config`, worktree `/home/ubuntu/repos/suara-lapangan-w12-llm-provider`.

**Blocked by:** 03, 04

**Status:** ready-for-agent

**Owner decision (recorded):** the provider migration waits for ticket 01, because it has to be numbered after `0005_auth_tables.sql` and the provider screens sit behind `/admin`'s auth gate. The backend of 03 therefore cannot start in parallel with 01.

**Findings from the paused provider thread:**
- The documents route falls back to `documentFromTurns` only when `MODEL_API_KEY` is unset, and on `upstream_unreachable`/`schema_rejected` it returns the fallback without persisting. Provider configuration must preserve both branches.
- The cost meter overstates: cached tokens are read nowhere, and the documents route meters a flat `$0.005` per document.
- `redactSecrets` in `lib/server/asr/log.ts` only scrubs `MODEL_API_KEY` and `SMTP_PASS`; provider API keys need their own scrubbing path.

- [ ] OpenAI-compatible chat calls work against a configured base URL
- [ ] Structured output works via `response_format`
- [ ] Provider errors are isolated and do not break the Meta path; both fallback branches preserved
- [ ] Speech is optional and falls back to Meta ASR when unavailable
- [ ] Test-connection reuses the same client code
- [ ] Provider keys scrubbed by their own path in `redactSecrets`
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green

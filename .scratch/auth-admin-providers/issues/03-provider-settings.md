# 03: Provider settings (admin)

**What to build:** admin-editable LLM provider settings: Meta Muse (built in, always available, default, cannot be deleted) plus any OpenAI-compatible provider (base URL + API key + model). Keys encrypted at rest, masked in the UI, with a test-connection button. A provider row drives which endpoint and credentials the model client uses. Resume branch `agent/12-llm-provider-config`, worktree `/home/ubuntu/repos/suara-lapangan-w12-llm-provider` (clean, nothing committed — confirmed by owner).

**Blocked by:** 01

**Status:** ready-for-agent

**Owner decision (recorded):** the provider migration waits for ticket 01, because it has to be numbered after `0005_auth_tables.sql` and the provider screens sit behind `/admin`'s auth gate. The backend of 03 therefore cannot start in parallel with 01.

**Findings from the paused provider thread:**
- The admin seam must read `role='admin'` from the `0005_auth_tables.sql` schema (which already defines role and ban columns plus `scripts/seed-admin.mjs`), not invent a second role source.
- `redactSecrets` in `lib/server/asr/log.ts` only scrubs `MODEL_API_KEY` and `SMTP_PASS`; provider API keys need their own scrubbing path so they never leak into logs.
- The cost meter overstates: cached tokens are read nowhere, and the documents route meters a flat `$0.005` per document. Provider settings must feed real token/cached-token counts where available.

- [ ] `providers` table (migration numbered after `0005_auth_tables.sql`) with kind `meta` | `openai_compat`, base_url, encrypted_api_key, model, enabled, is_default
- [ ] Meta Muse built-in row seeded and non-deletable
- [ ] Admin UI lists providers and allows add/edit/enable/disable/delete (except Meta Muse); behind `/admin` auth gate
- [ ] API keys encrypted at rest and masked in all responses
- [ ] Test-connection button reports success/failure without leaking the key
- [ ] Default provider is Meta Muse when none is chosen
- [ ] Admin seam reads `role='admin'` from the `0005_auth_tables.sql` schema
- [ ] Provider keys scrubbed by their own path in `redactSecrets`
- [ ] `npm run typecheck`, `npm run lint`, `npm test` green

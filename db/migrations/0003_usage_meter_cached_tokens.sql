-- Track model prompt-cache hits distinctly from input tokens (ticket 04).
--
-- `tokens` stays the total input tokens the server charges for; `cached_tokens`
-- is the prefix served from the prompt cache, which the Meta API reports at
-- `usage.input_tokens_details.cached_tokens` (Responses) or
-- `usage.prompt_tokens_details.cached_tokens` (Chat Completions). Counting the
-- two separately keeps the cost meter honest.
--
-- The column is nullable so the in-memory store and any store that skips this
-- migration keep working.

alter table usage_meter
    add column if not exists cached_tokens integer not null default 0 check (cached_tokens >= 0);

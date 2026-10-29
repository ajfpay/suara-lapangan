-- Daily usage meter and quota hard-stop (contracts K7, D8).
--
-- Tracks audio seconds transcribed, LLM tokens consumed, and estimated cost
-- per user (defaulting to 'default') per calendar day. When the daily cost or
-- audio cap is reached, `hard_stop` is set to true to reject new sessions.
-- Idempotent: safe to run on every start.

create table if not exists usage_meter (
    user_id text not null default 'default',
    day date not null default current_date,
    audio_seconds numeric(12, 2) not null default 0 check (audio_seconds >= 0),
    tokens integer not null default 0 check (tokens >= 0),
    est_cost numeric(10, 4) not null default 0 check (est_cost >= 0),
    hard_stop boolean not null default false,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, day)
);

create index if not exists usage_meter_day_idx on usage_meter (day);

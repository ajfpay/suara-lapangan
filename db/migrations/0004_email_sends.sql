-- Daily email send meter (ticket 09).
--
-- Tracks count of email deliveries per user (defaulting to 'default') per
-- calendar day to enforce the daily send quota.
-- Idempotent: safe to run on every start.

create table if not exists email_send_meter (
    user_id text not null default 'default',
    day date not null default current_date,
    count integer not null default 0 check (count >= 0),
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    primary key (user_id, day)
);

create index if not exists email_send_meter_day_idx on email_send_meter (day);

-- Link documents and meter records to auth users (Ticket 11).
--
-- Adds nullable user_id to documents (legacy rows stay ownerless).
-- Updates usage_meter and email_send_meter to foreign-key auth_user.id.
-- Creates user_cost_limits for per-user daily cost caps.
-- Idempotent: safe to run on every start.

-- 1. Documents user_id foreign key
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'documents' and column_name = 'user_id'
    ) then
        alter table documents drop column user_id cascade;
    end if;
end $$;

alter table documents add column if not exists user_id uuid references auth_user (id) on delete set null;
create index if not exists documents_user_id_idx on documents (user_id);

-- 2. usage_meter: drop default, convert column to uuid if needed, add FK and index
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'usage_meter' and column_name = 'user_id' and data_type = 'text'
    ) then
        alter table usage_meter alter column user_id drop default;
        alter table usage_meter alter column user_id type uuid using user_id::uuid;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'usage_meter_user_id_fkey'
    ) then
        alter table usage_meter add constraint usage_meter_user_id_fkey
            foreign key (user_id) references auth_user (id) on delete cascade;
    end if;
end $$;

create index if not exists usage_meter_user_id_idx on usage_meter (user_id);

-- 3. email_send_meter: drop default, convert column to uuid if needed, add FK and index
do $$
begin
    if exists (
        select 1 from information_schema.columns
        where table_name = 'email_send_meter' and column_name = 'user_id' and data_type = 'text'
    ) then
        alter table email_send_meter alter column user_id drop default;
        alter table email_send_meter alter column user_id type uuid using user_id::uuid;
    end if;

    if not exists (
        select 1 from pg_constraint where conname = 'email_send_meter_user_id_fkey'
    ) then
        alter table email_send_meter add constraint email_send_meter_user_id_fkey
            foreign key (user_id) references auth_user (id) on delete cascade;
    end if;
end $$;

create index if not exists email_send_meter_user_id_idx on email_send_meter (user_id);

-- 4. Per-user daily cost limit table for admin dashboard
create table if not exists user_cost_limits (
    user_id          uuid primary key references auth_user (id) on delete cascade,
    daily_cost_limit numeric(10, 4) not null check (daily_cost_limit >= 0),
    created_at       timestamptz not null default now(),
    updated_at       timestamptz not null default now()
);

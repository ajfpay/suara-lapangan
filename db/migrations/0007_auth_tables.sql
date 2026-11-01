-- Better Auth tables with auth_ prefix (Ticket 11).
--
-- Tables:
--   - auth_user: user accounts, email verification status, admin role, ban flags
--   - auth_session: user login sessions
--   - auth_account: authentication credentials and OAuth links (Google, etc.)
--   - auth_verification: tokens for email confirmation and password reset
-- Idempotent: safe to run on every start.

create table if not exists auth_user (
    id              uuid primary key default gen_random_uuid(),
    email           text unique not null,
    email_verified  boolean not null default false,
    name            text not null,
    password_hash   text,
    image           text,
    role            text not null default 'user',
    banned          boolean not null default false,
    ban_reason      text,
    ban_expires     timestamptz,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists auth_session (
    id              text primary key,
    expires_at      timestamptz not null,
    token           text unique not null,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    ip_address      text,
    user_agent      text,
    user_id         uuid not null references auth_user (id) on delete cascade
);

create table if not exists auth_account (
    id                      text primary key,
    account_id              text not null,
    provider_id             text not null,
    user_id                 uuid not null references auth_user (id) on delete cascade,
    access_token            text,
    refresh_token           text,
    id_token                text,
    access_token_expires_at timestamptz,
    refresh_token_expires_at timestamptz,
    id_token_expires_at     timestamptz,
    scope                   text,
    password                text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

create table if not exists auth_verification (
    id          text primary key,
    identifier  text not null,
    value       text not null,
    expires_at  timestamptz not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create index if not exists auth_session_user_id_idx on auth_session (user_id);
create index if not exists auth_account_user_id_idx on auth_account (user_id);
create index if not exists auth_verification_identifier_idx on auth_verification (identifier);

-- Default system account for legacy ownerless rows.
insert into auth_user (id, email, email_verified, name, role)
values
    ('00000000-0000-0000-0000-000000000000', 'system@suara-lapangan.local', true, 'System', 'admin')
on conflict (id) do nothing;

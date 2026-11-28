alter table documents add column if not exists draft_revision integer not null default 1 check (draft_revision > 0);

create table if not exists document_patch_receipts (
    document_id uuid not null references documents(id) on delete cascade,
    actor_id text not null,
    request_key text not null,
    fingerprint text not null,
    result jsonb not null,
    expires_at timestamptz not null default (now() + interval '24 hours'),
    primary key (document_id, actor_id, request_key)
);
create index if not exists document_patch_receipts_expiry_idx on document_patch_receipts(expires_at);

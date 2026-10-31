-- Documents persisted in Postgres (document-pipeline spec D2, ticket 01).
--
-- `data_json` holds the QuotationDocument payload the guard produces; PATCH
-- rewrites it, GET /api/documents/{id} reads it. `turns_hash` fingerprints the
-- turns a document was created from, so an identical create for the same
-- session on the same calendar day is idempotent while a deliberate re-create
-- stays distinct. `nomor` is not unique yet: the current default format
-- `SL/QTN/<date>/001` repeats across sessions until ticket 02 swaps in the
-- yearly allocator, which owns that constraint change. Idempotent: safe to run
-- on every start.

create table if not exists documents (
    id          uuid primary key default gen_random_uuid(),
    session_id  text not null references sessions (id) on delete cascade,
    locale      text not null check (locale in ('en', 'id')),
    nomor       text not null,
    status      text not null default 'perlu_konfirmasi'
                check (status in ('perlu_konfirmasi', 'siap', 'terkirim')),
    turns_hash  text not null,
    data_json   jsonb not null,
    pdf_path    text,
    sent_to     text,
    sent_at     timestamptz,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create unique index if not exists documents_session_day_hash_uidx
    on documents (session_id, turns_hash, ((created_at at time zone 'UTC')::date));

create table if not exists document_sequences (
    year        integer primary key,
    last_number integer not null default 0 check (last_number >= 0)
);

create index if not exists documents_session_id_idx on documents (session_id);

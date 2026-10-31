-- Documents persisted in Postgres (document-pipeline spec D2, ticket 01).
--
-- `data_json` holds the QuotationDocument payload the guard produces; PATCH
-- rewrites it, GET /api/documents/{id} reads it. `turns_hash` fingerprints the
-- turns a document was created from, so an identical create for the same
-- session on the same calendar day is idempotent while a deliberate re-create
-- stays distinct. `nomor` is unique per document: the yearly allocator
-- (ticket 02) hands out distinct numbers and this index is the second line of
-- defence. Idempotent: safe to run on every start.

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

-- Renumber documents created before this change. The old default nomor
-- SL/QTN/<date>/<nnn> repeated across sessions (spec B8), which the unique
-- index below forbids. Legacy numbers move to the yearly format, oldest
-- first within each year, continuing after any yearly number already
-- issued. Idempotent: already-migrated rows match nothing.
-- Refuses to run when a year's sequence is exhausted (9999 taken and legacy
-- rows still pending): folding 10000 into four digits would mint a wrong
-- number, so the migration fails loudly instead of writing a wrapped value.
do $$
declare exhausted int;
begin
    select count(*) into exhausted
    from (select yr, max(seq) as max_seq
          from (select substring(nomor from 8 for 4)::int as yr,
                       substring(nomor from 13 for 4)::int as seq
                from documents
                where nomor ~ '^SL/QTN/[0-9]{4}/[0-9]{4}$') s
          group by yr) m
    where exists (select 1 from documents
                  where nomor ~ ('^SL/QTN/' || m.yr::text || '-[0-9]{2}-[0-9]{2}/[0-9]{3}$'))
      and m.max_seq >= 9999;
    if exhausted > 0 then
        raise exception 'cannot migrate: a year has sequence 9999 taken and legacy nomor rows still to renumber';
    end if;
end $$;

with legacy as (
    select id,
           substring(nomor from 8 for 4)::int as yr,
           created_at
    from documents
    where nomor ~ '^SL/QTN/[0-9]{4}-[0-9]{2}-[0-9]{2}/[0-9]{3}$'
),
renumber as (
    select id, yr,
           (select coalesce(max(substring(d2.nomor from 13 for 4)::int), 0)
            from documents d2
            where d2.nomor ~ ('^SL/QTN/' || l.yr::text || '/[0-9]{4}$'))
           + row_number() over (partition by yr order by created_at, id)
             as seq
    from legacy l
)
update documents d
set nomor = 'SL/QTN/' || r.yr::text || '/' || lpad(r.seq::text, 4, '0')
from renumber r
where d.id = r.id;

-- Keep the allocator's sequence ahead of any number now in the table.
insert into document_sequences (year, last_number)
select substring(nomor from 8 for 4)::int,
       max(substring(nomor from 13 for 4)::int)
from documents
where nomor ~ '^SL/QTN/[0-9]{4}/[0-9]{4}$'
group by 1
on conflict (year) do update
    set last_number = greatest(document_sequences.last_number, excluded.last_number);

-- Second line of defence behind the yearly allocator (spec D5): even if a
-- caller bypasses it, two documents can never carry the same number.
create unique index if not exists documents_nomor_uidx
    on documents (nomor);

create index if not exists documents_session_id_idx on documents (session_id);

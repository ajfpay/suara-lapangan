-- Review-before-PDF (spec D2, ticket 01).
--
-- A document is now created as an editable draft (`draf`) with no sequence
-- number; the number is allocated when the document is approved. This
-- migration relaxes `nomor`, widens the status vocabulary, and adds the audit
-- and versioning columns the approval flow writes.
--
-- Legacy rows keep their stored status. `siap` and `perlu_konfirmasi` stay
-- legal here so no blocking data migration is needed; the application layer
-- normalizes them on read (`perlu_konfirmasi` -> `draf`, `siap` ->
-- `disetujui`). Idempotent: safe to run on every start.

begin;

-- gen_random_uuid() backs the root_id default below.
create extension if not exists pgcrypto;

-- 1. Relax nomor not-null constraint
alter table documents alter column nomor drop not null;

-- 2. Update status constraint to include new vocabulary alongside legacy
alter table documents drop constraint if exists documents_status_check;
alter table documents add constraint documents_status_check
    check (status in ('draf', 'disetujui', 'terkirim', 'perlu_konfirmasi', 'siap'));

-- 3. Add audit columns
alter table documents add column if not exists approved_at timestamptz;
alter table documents add column if not exists approved_by text;
alter table documents add column if not exists field_changes jsonb not null default '[]';

-- 4. Add versioning columns
alter table documents add column if not exists version integer not null default 1;
alter table documents add column if not exists root_id uuid default gen_random_uuid();
alter table documents add column if not exists parent_id uuid references documents (id) on delete set null;
alter table documents add column if not exists superseded_by uuid references documents (id) on delete set null;

-- 5. Backfill root_id for existing documents, then enforce NOT NULL.
update documents set root_id = id where root_id is null;
-- No column DEFAULT: new rows omit root_id and the trigger below fills it
-- with the row's own id (root is its own root). A DEFAULT
-- gen_random_uuid() would fire before the BEFORE INSERT trigger and defeat
-- its WHEN (new.root_id is null) clause, leaving root_id != id.
alter table documents alter column root_id drop default;
alter table documents alter column root_id set not null;

-- 5a. New inserts set root_id to their own id (root is its own root). Postgres
-- evaluates column defaults before BEFORE INSERT triggers, so NEW.id is already
-- assigned here; the WHEN clause makes it a no-op for any INSERT that already
-- supplies root_id. This keeps root_id NOT NULL while never firing for the
-- application layer, which omits root_id and lets the default + this trigger
-- fill both.
create or replace function documents_default_root_id() returns trigger
language plpgsql as $$
begin
    if new.root_id is null then
        new.root_id := new.id;
    end if;
    return new;
end;
$$;
drop trigger if exists documents_default_root_id on documents;
create trigger documents_default_root_id
    before insert on documents
    for each row
    when (new.root_id is null)
    execute function documents_default_root_id();

-- 6. Replace uniqueness on session+hash+day with partial index for v1 only.
-- A revision of the same session and turns is a new lineage, so only the
-- first version of a lineage is the idempotent one.
drop index if exists documents_session_day_hash_uidx;
create unique index documents_session_day_hash_uidx
    on documents (session_id, turns_hash, ((created_at at time zone 'UTC')::date))
    where version = 1;

-- 7. Add unique constraint for versioning within a document root
create unique index if not exists documents_root_version_uidx
    on documents (root_id, version);

commit;

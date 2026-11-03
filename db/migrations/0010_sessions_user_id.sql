-- Link sessions to auth users (ticket 08).
--
-- Adds nullable user_id to sessions (legacy rows stay ownerless and are
-- denied to non-admin callers by the turns route). Idempotent: safe to run
-- on every start.

begin;

alter table sessions add column if not exists user_id uuid references auth_user (id) on delete set null;

create index if not exists sessions_user_id_idx on sessions (user_id);

commit;

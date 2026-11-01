-- Migration 0006: record the ASR mode on a session.
--
-- The transcript cache is keyed by session id and audio hash. Without the mode
-- in that identity, re-uploading the same audio in DIARIZATION after an
-- ENDPOINTING run replays the speaker-free turns and the speaker labels never
-- appear. Existing rows default to ENDPOINTING, which is what they were
-- transcribed with. Idempotent: safe to run on every start.

alter table sessions
    add column if not exists mode text not null default 'ENDPOINTING';

alter table sessions
    drop constraint if exists sessions_mode_check;

alter table sessions
    add constraint sessions_mode_check
    check (mode in ('ENDPOINTING', 'DIARIZATION'));

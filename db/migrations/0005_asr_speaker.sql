-- Migration 0005: Add speaker column to turns for DIARIZATION support.
-- Nullable: turns without speaker labels (e.g. ENDPOINTING mode) remain NULL.
alter table turns add column if not exists speaker text;

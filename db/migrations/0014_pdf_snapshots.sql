-- The approval key is stored on the version itself: a version can be approved once.
alter table documents add column if not exists approval_request_key text;
alter table documents add column if not exists pdf_document_hash text;

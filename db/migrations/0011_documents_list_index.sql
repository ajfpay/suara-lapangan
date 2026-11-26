create index if not exists documents_owner_root_version_idx
    on documents (user_id, (coalesce(root_id,id)), version desc, id desc);

create table if not exists auth_rate_limit (
    id text primary key,
    key text not null unique,
    count integer not null check (count > 0),
    last_request bigint not null
);

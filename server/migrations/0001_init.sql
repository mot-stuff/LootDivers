-- TASK-707 initial schema (PHASE7-INFRA-PLAN §2.4 indicative schema plus the
-- Phase 8 kickoff packet's class column and per-account name uniqueness).
-- The blob column is the DEC-014 character envelope, stored verbatim and
-- never parsed by the server (DEC-032). previous_* columns implement the
-- one-deep last-write-wins revision history.

create table users (
  id            uuid primary key default gen_random_uuid(),
  email         text not null unique,
  password_hash text not null,          -- argon2id
  created_at    timestamptz not null default now()
);

create table sessions (
  token_hash  text primary key,         -- server stores only the hash
  user_id     uuid not null references users (id) on delete cascade,
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index sessions_user_id_idx on sessions (user_id);
create index sessions_expires_at_idx on sessions (expires_at);

create table characters (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references users (id) on delete cascade,
  name              text not null,
  class             text not null default 'barbarian',
  level             integer not null default 1,
  format_version    integer,            -- observability only; null until first save
  revision          integer not null default 0,
  blob              jsonb,              -- the DEC-014 envelope, opaque; null until first save
  checksum          text,
  previous_blob     jsonb,              -- one-deep revision history (DEC-032)
  previous_revision integer,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create index characters_user_id_idx on characters (user_id);

-- Per-account, case-insensitive name uniqueness (DEC-036 draft).
create unique index characters_user_name_unique
  on characters (user_id, lower(name));

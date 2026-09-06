-- TASK-718 (DEC-044): retroactive save auditing and manual account bans.
--
-- users gains a nullable ban flag: banned_at set means every authenticated
-- request and every login is refused with 403 account-banned (checked in the
-- API's session hook). ban_reason is operator-facing text set by the ban
-- script (server/src/ban.ts).
--
-- save_rejections is the lean audit trail behind DEC-044's "no auto-ban"
-- stance: one row per 4xx save-content rejection (DEC-043 validation), no
-- blob storage. character_id deliberately has NO foreign key so the log
-- outlives character deletion; user_id cascades with the account because the
-- log exists to judge the account.

alter table users
  add column banned_at  timestamptz,
  add column ban_reason text;

create table save_rejections (
  id           bigint generated always as identity primary key,
  user_id      uuid not null references users (id) on delete cascade,
  character_id uuid not null,
  code         text not null,
  created_at   timestamptz not null default now()
);

create index save_rejections_user_id_idx on save_rejections (user_id);

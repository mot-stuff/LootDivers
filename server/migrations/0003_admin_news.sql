-- TASK-720 (DEC-046): admin accounts and the news table.
--
-- users.is_admin marks the accounts allowed through the /admin/* route
-- guard. It is ONLY ever set by the promote-admin/demote-admin CLIs
-- (server/src/promote-admin.ts) — no HTTP path grants or revokes the role.
--
-- news replaces the repo's static src/home/news.json (DEC-035): the
-- homepage reads public GET /news, admins manage entries through the
-- admin API. body is plain text/markdown — renderers must escape it
-- (never inject as HTML). The seed below carries over the news.json
-- entries that shipped with the static file so nothing disappears;
-- published_at times are staggered to preserve the file's display order
-- under the newest-first sort.

alter table users
  add column is_admin boolean not null default false;

create table news (
  id           uuid primary key default gen_random_uuid(),
  title        text not null,
  body         text not null,
  author       text not null default 'Loot Divers Team',
  published_at timestamptz not null default now(),
  created_at   timestamptz not null default now()
);

create index news_published_at_idx on news (published_at desc);

insert into news (title, body, author, published_at) values
  (
    'Character saves arrive',
    'Your hero now persists between sessions. Progress is written automatically when you travel between zones and when you close the tab, and the main menu''s Continue button picks up right where you left off — level, gear, gold, professions, and quest progress included.',
    'Loot Divers Team',
    '2026-09-05T12:00:00Z'
  ),
  (
    'The world opens: Hearthmere and beyond',
    'The first slice of the overworld is live. Set out from the town of Hearthmere into the Ashtrail Expanse, descend into the Hollowdeep, and face Embercleft at the bottom. Pack hunts, an elite, a boss, a vendor, and your first quest await — with a minimap to keep you oriented.',
    'Loot Divers Team',
    '2026-09-05T11:00:00Z'
  ),
  (
    'Loot Divers enters the browser',
    'The game now runs entirely in your browser — no download, no launcher. New divers wash ashore at Wakeshore Landing, a short tutorial cove that teaches movement, combat, dodging, looting, and gathering before the road to Hearthmere opens.',
    'Loot Divers Team',
    '2026-09-04T12:00:00Z'
  );

-- Pathtoon Studio — Stage 3: scripts (versioned, panel by panel), prop table, vote card.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Admin-only. No public-site tables and no storage changes.

-- ------------------------------------------------------------------ script versions
-- One row per version of an episode's script. The highest version is the working copy;
-- starting a new version freezes the one before it.
create table if not exists public.studio_scripts (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.studio_projects (id) on delete cascade,
  episode_id    uuid not null references public.studio_episodes (id) on delete cascade,
  version       integer not null check (version > 0),
  changelog     text not null default '',
  check_result  jsonb,          -- Claude's last check of THIS version
  checked_at    timestamptz,
  created_by    uuid references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  unique (episode_id, version)
);

-- ------------------------------------------------------------------ panels
create table if not exists public.studio_script_panels (
  id           uuid primary key default gen_random_uuid(),
  script_id    uuid not null references public.studio_scripts (id) on delete cascade,
  panel_key    text not null,                 -- permanent id; survives reordering and new versions
  position     integer not null,
  title        text not null default '',
  shot         text,                          -- e.g. "exterior, establishing"
  camera       text,
  characters   text[] not null default '{}',
  action       text,                          -- the visual
  caption      text,                          -- 7 words or fewer
  dialogue     jsonb not null default '[]'::jsonb,   -- [{speaker, line}]
  size         text not null default 'mid' check (size in ('small', 'mid', 'tall')),
  gap_after    integer not null default 250 check (gap_after >= 0 and gap_after <= 5000),
  props        jsonb not null default '[]'::jsonb,   -- [{name, location, state}]
  clock        text,                          -- e.g. "6:43"
  matches_key  text,                          -- panel_key of the panel whose camera this repeats
  text_items   jsonb not null default '[]'::jsonb,   -- [{text, how: "lettered" | "model"}]
  notes        text,
  unique (script_id, panel_key)
);
create index if not exists studio_script_panels_script_idx on public.studio_script_panels (script_id, position);

-- ------------------------------------------------------------------ prop table (per project)
create table if not exists public.studio_props (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects (id) on delete cascade,
  name        text not null,
  owner       text,
  rule        text,          -- how it works / where it lives / exact label text
  unique (project_id, name)
);

-- ------------------------------------------------------------------ vote card (serial episodes)
create table if not exists public.studio_forks (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.studio_projects (id) on delete cascade,
  episode_id   uuid not null unique references public.studio_episodes (id) on delete cascade,
  question     text,
  in_bounds    text,
  locked       text,
  backup_pick  text,
  branches     jsonb not null default '[]'::jsonb,   -- [{title, summary, rejoins}]
  updated_at   timestamptz not null default now()
);

-- ------------------------------------------------------------------ row-level security
do $$
declare t text;
begin
  foreach t in array array['studio_scripts','studio_script_panels','studio_props','studio_forks'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "studio: admin only" on public.%I', t);
    execute format(
      'create policy "studio: admin only" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t);
  end loop;
end $$;

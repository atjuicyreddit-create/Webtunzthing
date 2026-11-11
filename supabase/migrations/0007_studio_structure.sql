-- Pathtoon Studio — Stage 2: structure board (season > episodes > acts > scenes).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Admin-only. No public-site tables and no storage changes.

-- ------------------------------------------------------------------ episodes (extend)
alter table public.studio_episodes
  add column if not exists summary      text,
  add column if not exists milestone_id uuid references public.studio_milestones (id) on delete set null;

-- ------------------------------------------------------------------ acts
create table if not exists public.studio_acts (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects (id) on delete cascade,
  episode_id  uuid not null references public.studio_episodes (id) on delete cascade,
  position    integer not null default 0,
  title       text not null default ''
);

-- ------------------------------------------------------------------ scenes
create table if not exists public.studio_scenes (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid not null references public.studio_projects (id) on delete cascade,
  episode_id        uuid not null references public.studio_episodes (id) on delete cascade,
  act_id            uuid not null references public.studio_acts (id) on delete cascade,
  position          integer not null default 0,
  title             text not null default '',
  purpose           text,                                -- which spine point or milestone it serves
  beat              text,
  characters        text[] not null default '{}',
  location          text,
  props_introduced  text[] not null default '{}',        -- props first shown here
  props_used        text[] not null default '{}',        -- props used here (must be introduced earlier or here)
  plants            text[] not null default '{}',        -- set-ups planted here
  payoffs           text[] not null default '{}',        -- set-ups paid off here
  chain             text,                                -- a real-world sequence, e.g. "coffee"
  chain_step        integer,                             -- its step number, e.g. 2 = grind
  reader_choice     text,                                -- the vote question, if any
  updated_at        timestamptz not null default now()
);

create index if not exists studio_acts_episode_idx on public.studio_acts (episode_id, position);
create index if not exists studio_scenes_act_idx on public.studio_scenes (act_id, position);
create index if not exists studio_scenes_project_idx on public.studio_scenes (project_id);

-- Claude's reorder suggestions carry the proposed order here.
alter table public.studio_suggestions add column if not exists payload jsonb;

-- ------------------------------------------------------------------ row-level security
do $$
declare t text;
begin
  foreach t in array array['studio_acts','studio_scenes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "studio: admin only" on public.%I', t);
    execute format(
      'create policy "studio: admin only" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t);
  end loop;
end $$;

-- ------------------------------------------------------------------ renumber episodes in one go
-- Runs with the caller's permissions (admin-only rules apply). Moves numbers out of the
-- way first so the unique (project, number) rule is never broken part-way through.
create or replace function public.studio_reorder_episodes(p_project uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  update public.studio_episodes set number = number + 10000 where project_id = p_project;
  update public.studio_episodes e
     set number = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where e.id = o.id and e.project_id = p_project;
end;
$$;

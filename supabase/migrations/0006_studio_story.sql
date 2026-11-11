-- Pathtoon Studio — Stage 1: idea and story builder.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Admin-only, like Stage 0. No public-site tables and no storage changes.

-- ------------------------------------------------------------------ project fields
alter table public.studio_projects
  add column if not exists tone             text,
  add column if not exists audience         text,
  add column if not exists episodes_planned integer check (episodes_planned is null or episodes_planned between 1 and 100),
  add column if not exists loglines         jsonb not null default '[]'::jsonb,  -- [{text, why}] from Claude
  add column if not exists logline          text,                                 -- the one Tom picked or wrote
  add column if not exists one_line         text,                                 -- the one-line test sentence
  add column if not exists one_line_check   jsonb,                                -- {passes, problems[]} from the last check
  add column if not exists season_summary   text,
  add column if not exists destination      text;                                 -- serial only

-- ------------------------------------------------------------------ question cards
-- One row per answered (or suggested) card. Saved as you go, so a session resumes.
create table if not exists public.studio_story_answers (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.studio_projects (id) on delete cascade,
  question_key  text not null,
  answer        text,
  source        text check (source in ('suggestion', 'own', 'from_idea')),
  suggestions   jsonb not null default '[]'::jsonb,   -- [{answer, why}] last shown
  updated_at    timestamptz not null default now(),
  unique (project_id, question_key)
);

-- ------------------------------------------------------------------ "Why?" pass
create table if not exists public.studio_why_items (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects (id) on delete cascade,
  position    integer not null default 0,
  item        text not null,      -- e.g. "the potions in his kitchen"
  question    text not null,      -- e.g. "Why are the potions in his kitchen?"
  reason      text,               -- Tom's one line
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ characters
create table if not exists public.studio_characters (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects (id) on delete cascade,
  position    integer not null default 0,
  name        text not null,
  role        text not null default '',
  -- backstory, want, fear, flaw, voice, look {silhouette, colours [{name, hex}], signature},
  -- props [], costume_always, costume_never, guardrails []
  sheet       jsonb not null default '{}'::jsonb,
  updated_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ milestones (serial)
create table if not exists public.studio_milestones (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.studio_projects (id) on delete cascade,
  position     integer not null,
  title        text not null,
  description  text
);

-- ------------------------------------------------------------------ Claude's suggestions
create table if not exists public.studio_suggestions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects (id) on delete cascade,
  kind        text not null default 'plotline',
  text        text not null,
  why         text,
  status      text not null default 'pending' check (status in ('pending', 'accepted', 'rejected')),
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ row-level security
do $$
declare t text;
begin
  foreach t in array array[
    'studio_story_answers','studio_why_items','studio_characters',
    'studio_milestones','studio_suggestions'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "studio: admin only" on public.%I', t);
    execute format(
      'create policy "studio: admin only" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t);
  end loop;
end $$;

create index if not exists studio_story_answers_project_idx on public.studio_story_answers (project_id);
create index if not exists studio_characters_project_idx on public.studio_characters (project_id, position);
create index if not exists studio_why_items_project_idx on public.studio_why_items (project_id, position);

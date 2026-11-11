-- Pathtoon Studio — Stage 5: panels, lettering, QA and lessons.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Admin-only. No public-site tables and no storage changes (images stay in the private
-- "studio" bucket from Stage 0).

-- ------------------------------------------------------------------ settings
alter table public.studio_settings
  add column if not exists max_takes_per_panel integer not null default 3;

-- ------------------------------------------------------------------ takes (extend)
alter table public.studio_takes
  add column if not exists lessons_applied jsonb not null default '[]'::jsonb,  -- [{id, lesson}]
  add column if not exists refs            jsonb not null default '[]'::jsonb,  -- [{label, path}] in the order sent
  add column if not exists parent_take_id  uuid references public.studio_takes (id) on delete set null,
  add column if not exists change_note     text,                               -- the ONE thing a fix changes
  add column if not exists script_hash     text,                               -- the script panel it was drawn from
  add column if not exists auto_qa         jsonb,                              -- free checks in code
  add column if not exists qa_ticks        jsonb not null default '{}'::jsonb, -- Tom's manual checklist
  add column if not exists qa_ticked       boolean not null default false,
  add column if not exists rejected        boolean not null default false,
  add column if not exists reject_reason   text;

-- ------------------------------------------------------------------ panels
-- One row per script panel (by its stable key) once art work starts on it.
create table if not exists public.studio_panels (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.studio_projects (id) on delete cascade,
  episode_id         uuid not null references public.studio_episodes (id) on delete cascade,
  panel_key          text not null,
  chosen_take_id     uuid references public.studio_takes (id) on delete set null,
  direction          text,                                -- the joke-carrying expression or eye direction (prompt block 2)
  precheck           jsonb,                               -- Claude's prompt check (before any spend)
  precheck_hash      text,                                -- which prompt that check was for
  letter_layout     jsonb not null default '[]'::jsonb,  -- lettering elements, positions at 1600 px wide
  lettered_path      text,
  lettered_take_id   uuid references public.studio_takes (id) on delete set null,
  lettered_hash      text,                                -- layout + script text the lettering was made from
  lettered_at        timestamptz,
  compare_path       text,                                -- test pack: the old lettered panel, for comparison
  qa                 jsonb,                               -- Claude's vision findings (shown, never acted on)
  qa_at              timestamptz,
  qa_lettered_path   text,
  updated_at         timestamptz not null default now(),
  unique (episode_id, panel_key)
);

-- Rule: a panel's chosen art is a finished, Tom-checked FINAL take of that same panel
-- (or an imported test-pack master). Exploration images can never be chosen.
create or replace function public.studio_guard_panel()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  t public.studio_takes%rowtype;
begin
  if new.chosen_take_id is not null and (tg_op = 'INSERT' or new.chosen_take_id is distinct from old.chosen_take_id) then
    select * into t from public.studio_takes where id = new.chosen_take_id;
    if t.id is null or t.kind = 'exploration' then
      raise exception 'Exploration images can never be used as panel art.';
    end if;
    if t.kind not in ('final', 'imported') or t.status <> 'ready' or t.storage_path is null then
      raise exception 'Only a finished panel image can be chosen.';
    end if;
    if t.episode_id is distinct from new.episode_id or t.panel_key is distinct from new.panel_key then
      raise exception 'That image belongs to a different panel.';
    end if;
    if not t.qa_ticked then
      raise exception 'Tick the QA checklist for this image before choosing it.';
    end if;
    if t.rejected then
      raise exception 'That image was rejected.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studio_panels_guard on public.studio_panels;
create trigger studio_panels_guard
  before insert or update on public.studio_panels
  for each row execute function public.studio_guard_panel();

-- ------------------------------------------------------------------ lessons (extend)
alter table public.studio_lessons
  add column if not exists project_id      uuid references public.studio_projects (id) on delete cascade,
  add column if not exists is_key          boolean not null default false,
  add column if not exists entry_ref       text,       -- e.g. "2026-11-09 · Morning Brew · Panels round 2 · P08"
  add column if not exists gens            integer,
  add column if not exists kie_usd         numeric(10,4),
  add column if not exists origin_take_id  uuid references public.studio_takes (id) on delete set null,
  add column if not exists updated_at      timestamptz not null default now();
create unique index if not exists studio_lessons_entry_idx on public.studio_lessons (entry_ref) where entry_ref is not null;

-- A lesson only counts once Tom approves it.
create or replace function public.studio_guard_lesson()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.active and new.status <> 'approved' then
    raise exception 'Approve a lesson before switching it on.';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studio_lessons_guard on public.studio_lessons;
create trigger studio_lessons_guard
  before insert or update on public.studio_lessons
  for each row execute function public.studio_guard_lesson();

-- The six key lessons from the brief start approved and active.
insert into public.studio_lessons (stage, problem, lesson, tag, theme, scope, status, active, source, is_key, entry_ref)
values
  ('process', 'Panels drawn before the script was final had to be redrawn.', 'No panels before the script is final.', 'art', 'process', 'global', 'approved', true, 'brief', true, 'key:1'),
  ('panels', 'Characters drifted off-costume when a lock was missing from the prompt.', 'Costume locks go in every prompt, including what a character never wears.', 'art', 'continuity', 'global', 'approved', true, 'brief', true, 'key:2'),
  ('lettering', 'AI-drawn clocks and words came out wrong.', 'Clocks and dialogue are drawn in code, never by the image model.', 'art', 'lettering', 'global', 'approved', true, 'brief', true, 'key:3'),
  ('panels', 'A reference for a character not in the panel added an extra character.', 'Attach references only for characters who are in the panel.', 'art', 'camera', 'global', 'approved', true, 'brief', true, 'key:4'),
  ('panels', 'A redraw lost the gag or copied an old reference.', 'Compare each redraw with the best earlier take at thumbnail size.', 'art', 'expressions', 'global', 'approved', true, 'brief', true, 'key:5'),
  ('panels', 'The word "filter" in a prompt added a dripper.', 'Never describe objects you don''t want in the picture.', 'art', 'unrequested', 'global', 'approved', true, 'brief', true, 'key:6')
on conflict (entry_ref) where entry_ref is not null do nothing;

-- ------------------------------------------------------------------ row-level security
alter table public.studio_panels enable row level security;
drop policy if exists "studio: admin only" on public.studio_panels;
create policy "studio: admin only" on public.studio_panels
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

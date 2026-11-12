-- Pathtoon Studio: the story writer ("tell it, Claude organises it").
-- Tom writes the episode in his own words; Claude turns it into a draft with blanks,
-- a portfolio of every detail mentioned, and a story-health read. Each Update is a new version.
-- Admin-only like every other studio table. Changes no existing rows.

-- Which story flow a project uses. Existing projects stay on the classic question cards;
-- new projects start on the story writer. Either can be switched from the Story page.
alter table public.studio_projects
  add column if not exists story_mode text not null default 'classic'
    check (story_mode in ('classic', 'draft'));
alter table public.studio_projects alter column story_mode set default 'draft';

create table if not exists public.studio_story_drafts (
  id             uuid primary key default gen_random_uuid(),
  project_id     uuid not null references public.studio_projects (id) on delete cascade,
  version        int  not null check (version >= 1),
  -- {about, setting, lead, backstory}
  quickstart     jsonb not null default '{}'::jsonb,
  -- Tom's own walkthrough of the episode, as written for this version
  telling        text not null default '',
  -- {synopsis, beats [{id, heading, text}], blanks [{id, beat_id, question, kind, guess, options, answer}]}
  draft          jsonb not null default '{}'::jsonb,
  -- {characters, places, objects [{name, role?, facts [{text, from, guessed}]}], mysteries [{text, from}]}
  portfolio      jsonb not null default '{}'::jsonb,
  -- {spine {...}, one_line, one_line_passes, notes [{level, text}], panels_estimate, episode_split}
  health         jsonb not null default '{}'::jsonb,
  -- what Tom asked to change to produce this version, and Claude's list of what changed
  change_request text,
  changes        jsonb not null default '[]'::jsonb,
  ai_call_id     uuid references public.studio_ai_calls (id) on delete set null,
  created_by     uuid references auth.users (id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (project_id, version)
);

alter table public.studio_story_drafts enable row level security;
drop policy if exists "studio: admin only" on public.studio_story_drafts;
create policy "studio: admin only" on public.studio_story_drafts
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

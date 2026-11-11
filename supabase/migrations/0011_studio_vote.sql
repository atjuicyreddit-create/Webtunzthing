-- Pathtoon Studio — Stage 8: reader vote (the winning comment).
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Admin-only. It READS the public comments; it never changes comments, episodes, series or
-- panels. No storage changes.

-- ------------------------------------------------------------------ settings
alter table public.studio_settings
  add column if not exists vote_min_comments integer not null default 3,
  add column if not exists vote_max_comments integer not null default 30;

-- ------------------------------------------------------------------ episodes (extend)
-- comment_source_episode_id: a READ-ONLY pointer to the live episode whose comments are read.
-- It is not a publish link: published_episode_id stays untouched.
-- reader_route: the decision that leads INTO this episode (route, "You chose" line, credit, branch).
alter table public.studio_episodes
  add column if not exists comment_source_episode_id uuid references public.episodes (id) on delete set null,
  add column if not exists reader_route jsonb;

-- ------------------------------------------------------------------ vote rounds
-- One row per screening of one episode's vote. Older rounds are kept as history.
create table if not exists public.studio_vote_rounds (
  id                 uuid primary key default gen_random_uuid(),
  project_id         uuid not null references public.studio_projects (id) on delete cascade,
  episode_id         uuid not null references public.studio_episodes (id) on delete cascade,  -- whose vote card this is
  source_episode_id  uuid,                    -- the live episode read (plain id: history survives deletes)
  status             text not null default 'screened' check (status in ('screened', 'decided')),
  fork_snapshot      jsonb not null default '{}'::jsonb,   -- vote card at screening time
  summary            text,
  ai_call_id         uuid references public.studio_ai_calls (id) on delete set null,
  screened_at        timestamptz not null default now(),
  decision           jsonb,                   -- {kind, vote_comment_id, route, you_chose, credit, branch, rejoins, override_note}
  decided_by         uuid references auth.users (id),
  decided_at         timestamptz,
  note               text,
  updated_at         timestamptz not null default now()
);
create index if not exists studio_vote_rounds_ep_idx on public.studio_vote_rounds (episode_id, screened_at desc);

-- A frozen copy of each comment as it was judged (live comments can be edited or deleted).
create table if not exists public.studio_vote_comments (
  id              uuid primary key default gen_random_uuid(),
  round_id        uuid not null references public.studio_vote_rounds (id) on delete cascade,
  comment_id      uuid,                       -- plain id, no foreign key, on purpose
  author_name     text,
  body            text not null,
  posted_at       timestamptz,
  skipped_reason  text,                       -- empty | duplicate | over_cap (null = sent to Claude)
  flags           text[] not null default '{}',  -- short | link
  verdict         text check (verdict in ('pass', 'near', 'veto')),
  reason          text,
  breaks          text[] not null default '{}',
  adjusted        text,
  label           text,                       -- short "You chose…" phrase
  branch          text,
  unsafe          boolean not null default false,
  suggested_rank  integer,
  tom_adjusted    text,
  tom_label       text,
  tom_branch      text
);
create index if not exists studio_vote_comments_round_idx on public.studio_vote_comments (round_id);

-- Rule: a decision names a comment from the SAME round; unsafe comments can never win;
-- choosing a vetoed comment needs Tom's override note.
create or replace function public.studio_guard_vote_round()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  c public.studio_vote_comments%rowtype;
begin
  if new.status = 'decided' then
    if new.decision is null or new.decided_at is null then
      raise exception 'A decided vote needs a decision.';
    end if;
    if new.decision->>'kind' = 'comment' then
      select * into c from public.studio_vote_comments
        where id = nullif(new.decision->>'vote_comment_id', '')::uuid and round_id = new.id;
      if c.id is null then
        raise exception 'That comment is not part of this vote.';
      end if;
      if c.unsafe then
        raise exception 'An unsafe comment can never be chosen.';
      end if;
      if c.skipped_reason is not null or c.verdict is null then
        raise exception 'That comment was not screened.';
      end if;
      if c.verdict = 'veto' and coalesce(btrim(new.decision->>'override_note'), '') = '' then
        raise exception 'Choosing a vetoed comment needs a note saying why.';
      end if;
    elsif new.decision->>'kind' <> 'backup' then
      raise exception 'Unknown kind of decision.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studio_vote_rounds_guard on public.studio_vote_rounds;
create trigger studio_vote_rounds_guard
  before insert or update on public.studio_vote_rounds
  for each row execute function public.studio_guard_vote_round();

-- Rule: what was judged can't change once the vote is decided (reopen first).
create or replace function public.studio_guard_vote_comment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if exists (select 1 from public.studio_vote_rounds r where r.id = old.round_id and r.status = 'decided') then
    raise exception 'This vote is decided. Reopen it before changing it.';
  end if;
  return new;
end;
$$;
drop trigger if exists studio_vote_comments_guard on public.studio_vote_comments;
create trigger studio_vote_comments_guard
  before update on public.studio_vote_comments
  for each row execute function public.studio_guard_vote_comment();

-- ------------------------------------------------------------------ row-level security
alter table public.studio_vote_rounds enable row level security;
alter table public.studio_vote_comments enable row level security;
drop policy if exists "studio: admin only" on public.studio_vote_rounds;
create policy "studio: admin only" on public.studio_vote_rounds
  for all to authenticated using (public.is_admin()) with check (public.is_admin());
drop policy if exists "studio: admin only" on public.studio_vote_comments;
create policy "studio: admin only" on public.studio_vote_comments
  for all to authenticated using (public.is_admin()) with check (public.is_admin());

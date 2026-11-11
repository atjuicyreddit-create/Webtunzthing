-- Pathtoon — Stage 2 (part): comments on episodes.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.

create table if not exists public.comments (
  id          uuid primary key default gen_random_uuid(),
  episode_id  uuid not null references public.episodes (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  -- Copied from the profile when the comment is written, because readers
  -- can't look at other people's profiles.
  author_name text not null default '',
  body        text not null check (char_length(btrim(body)) between 1 and 1000),
  created_at  timestamptz not null default now()
);

create index if not exists comments_episode_idx on public.comments (episode_id, created_at);

-- Fill in the author's name from their profile (they can't fake someone else's).
create or replace function public.set_comment_author()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.user_id := auth.uid();
  select coalesce(nullif(p.display_name, ''), 'Reader')
    into new.author_name
    from public.profiles p
   where p.id = auth.uid();
  new.author_name := coalesce(new.author_name, 'Reader');
  return new;
end;
$$;

drop trigger if exists comments_set_author on public.comments;
create trigger comments_set_author
  before insert on public.comments
  for each row execute function public.set_comment_author();

alter table public.comments enable row level security;

-- Anyone can read comments on episodes they're allowed to see.
drop policy if exists "comments: read on visible episodes" on public.comments;
create policy "comments: read on visible episodes" on public.comments
  for select using (
    exists (select 1 from public.episodes e where e.id = comments.episode_id)
  );

-- Signed-in people can comment on published episodes, as themselves.
drop policy if exists "comments: signed-in write own" on public.comments;
create policy "comments: signed-in write own" on public.comments
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.episodes e
      where e.id = comments.episode_id
        and e.status = 'published'
        and e.published_at is not null
        and e.published_at <= now()
    )
  );

-- You can delete your own comment; admins can delete any.
drop policy if exists "comments: delete own or admin" on public.comments;
create policy "comments: delete own or admin" on public.comments
  for delete to authenticated
  using (user_id = (select auth.uid()) or public.is_admin());

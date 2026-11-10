-- Pathtoon — Stage 3: admin area + "paid early" episodes.
-- Run once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run.

-- 1) Episodes can be free for everyone, or "paid early":
--    admins and supporters get them first; everyone else waits until early_until.
alter table public.episodes
  add column if not exists access text not null default 'free'
    check (access in ('free', 'paid_early')),
  add column if not exists early_until timestamptz;

-- 2) Is the current visitor a supporter (paying plan)? Used by the rules below.
create or replace function public.is_supporter()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and plan = 'supporter'
  );
$$;

-- 3) Panels are the actual art, so they are what we lock. The episode row
--    (title, synopsis) stays visible so readers can see what they're missing.
drop policy if exists "panels: public read published" on public.panels;
create policy "panels: public read published" on public.panels
  for select using (
    public.is_admin()
    or exists (
      select 1 from public.episodes e
      where e.id = panels.episode_id
        and e.status = 'published'
        and e.published_at is not null
        and e.published_at <= now()
        and (
          e.access = 'free'
          or (e.early_until is not null and e.early_until <= now())
          or public.is_supporter()
        )
    )
  );

-- 4) Re-order a whole episode's panels in one go (admin only, because it runs
--    with the caller's permissions, so the admin-only write rules apply).
create or replace function public.reorder_panels(p_episode uuid, p_ids uuid[])
returns void
language plpgsql
security invoker
set search_path = ''
as $$
begin
  -- Move everything out of the way first so the unique (episode, position)
  -- rule is never broken part-way through.
  update public.panels set position = position + 100000 where episode_id = p_episode;

  update public.panels p
     set position = o.ord
    from unnest(p_ids) with ordinality as o(id, ord)
   where p.id = o.id and p.episode_id = p_episode;
end;
$$;

-- Webzoon — Stage 1 schema.
-- Run this once in Supabase: SQL Editor > New query > paste > Run.
-- Safe to re-run: everything uses "if not exists" / "or replace".

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- profiles
-- One row per signed-in person. `role` and `plan` are ready for later:
--   role: 'reader' | 'admin'
--   plan: 'free' | 'supporter'   (the future £2.99/month plan; unused in v1)
create table if not exists public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  email        text,
  display_name text,
  role         text not null default 'reader' check (role in ('reader', 'admin')),
  plan         text not null default 'free'   check (plan in ('free', 'supporter')),
  created_at   timestamptz not null default now()
);

-- Create a profile automatically whenever someone signs up.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, display_name)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', split_part(new.email, '@', 1))
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Is the current visitor an admin? Used by the security rules below.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = (select auth.uid()) and role = 'admin'
  );
$$;

-- ------------------------------------------------------------------ series
create table if not exists public.series (
  id          uuid primary key default gen_random_uuid(),
  slug        text not null unique,
  title       text not null,
  tagline     text,
  description text,
  cover_url   text,
  created_at  timestamptz not null default now()
);

-- ---------------------------------------------------------------- episodes
create table if not exists public.episodes (
  id               uuid primary key default gen_random_uuid(),
  series_id        uuid not null references public.series (id) on delete cascade,
  number           integer not null check (number > 0),
  title            text not null,
  synopsis         text,
  status           text not null default 'draft' check (status in ('draft', 'published')),
  published_at     timestamptz,
  -- Used from Stage 2 (voting):
  vote_closes_at   timestamptz,
  hide_vote_counts boolean not null default false,
  created_at       timestamptz not null default now(),
  unique (series_id, number)
);

-- ------------------------------------------------------------------ panels
-- Each panel is one 800px-wide slice (drawn at 1600px). `gap_after` is the
-- empty scroll after the panel, in 800px-wide pixels:
--   same scene 150–300 · scene jump 500–800 · before the payoff 1000+
create table if not exists public.panels (
  id         uuid primary key default gen_random_uuid(),
  episode_id uuid not null references public.episodes (id) on delete cascade,
  position   integer not null check (position > 0),
  image_url  text not null,
  width      integer not null default 800,
  height     integer not null check (height > 0),
  gap_after  integer not null default 200 check (gap_after >= 0),
  alt        text,
  unique (episode_id, position)
);

create index if not exists panels_episode_idx on public.panels (episode_id, position);
create index if not exists episodes_series_idx on public.episodes (series_id, number);

-- ------------------------------------------------- Row Level Security (RLS)
alter table public.profiles enable row level security;
alter table public.series   enable row level security;
alter table public.episodes enable row level security;
alter table public.panels   enable row level security;

-- profiles: you can read your own; admins can read everyone. Nobody can edit
-- roles from the website — change them in the Supabase dashboard (see README).
drop policy if exists "profiles: read own or admin" on public.profiles;
create policy "profiles: read own or admin" on public.profiles
  for select using ((select auth.uid()) = id or public.is_admin());

-- series: public to read; only admins write.
drop policy if exists "series: public read" on public.series;
create policy "series: public read" on public.series
  for select using (true);
drop policy if exists "series: admin write" on public.series;
create policy "series: admin write" on public.series
  for all using (public.is_admin()) with check (public.is_admin());

-- episodes: readers only see published ones whose time has come.
drop policy if exists "episodes: public read published" on public.episodes;
create policy "episodes: public read published" on public.episodes
  for select using (
    (status = 'published' and published_at is not null and published_at <= now())
    or public.is_admin()
  );
drop policy if exists "episodes: admin write" on public.episodes;
create policy "episodes: admin write" on public.episodes
  for all using (public.is_admin()) with check (public.is_admin());

-- panels: visible when their episode is visible.
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
    )
  );
drop policy if exists "panels: admin write" on public.panels;
create policy "panels: admin write" on public.panels
  for all using (public.is_admin()) with check (public.is_admin());

-- ----------------------------------------------------------------- storage
-- Public bucket for panel images (used from Stage 3). Anyone can view; only
-- admins can upload.
insert into storage.buckets (id, name, public)
values ('panels', 'panels', true)
on conflict (id) do nothing;

drop policy if exists "panels bucket: admin upload" on storage.objects;
create policy "panels bucket: admin upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'panels' and public.is_admin());

drop policy if exists "panels bucket: admin update" on storage.objects;
create policy "panels bucket: admin update" on storage.objects
  for update to authenticated
  using (bucket_id = 'panels' and public.is_admin());

drop policy if exists "panels bucket: admin delete" on storage.objects;
create policy "panels bucket: admin delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'panels' and public.is_admin());

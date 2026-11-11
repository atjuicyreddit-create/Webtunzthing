-- Pathtoon Studio — Stage 4: assets (characters, locations, props), image takes and jobs.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Admin-only. No public-site tables and no storage changes (the private "studio"
-- bucket from Stage 0 holds the images).

-- ------------------------------------------------------------------ settings
-- KIE charges in credits. 12 credits = $0.06 per the pipeline rules, so $0.005 a credit.
alter table public.studio_settings
  add column if not exists kie_usd_per_credit numeric(10,6) not null default 0.005;

-- ------------------------------------------------------------------ assets
create table if not exists public.studio_assets (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.studio_projects (id) on delete cascade,
  kind            text not null check (kind in ('character', 'location', 'prop')),
  -- Characters are series-wide templates; locations and props can belong to one act.
  scope           text not null default 'series' check (scope in ('series', 'act')),
  act_id          uuid references public.studio_acts (id) on delete set null,
  character_id    uuid references public.studio_characters (id) on delete set null,
  name            text not null check (char_length(btrim(name)) between 1 and 80),
  description     text,
  prompt          text not null default '',
  aspect          text not null default '1:1' check (aspect in ('1:1', '3:4', '4:3', '9:16', '16:9')),
  status          text not null default 'needs_design' check (status in ('needs_design', 'picked', 'not_needed')),
  picked_take_id  uuid,                                   -- foreign key added below
  reference_path  text,                                   -- optional reference image in the studio bucket
  uses            jsonb not null default '{}'::jsonb,     -- {episode_id: [panel numbers]} from the final scripts
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create unique index if not exists studio_assets_name_idx
  on public.studio_assets (project_id, kind, lower(btrim(name)));

-- ------------------------------------------------------------------ jobs
-- One image generation in progress. The page polls a short status route; no request waits.
create table if not exists public.studio_jobs (
  id              uuid primary key default gen_random_uuid(),
  project_id      uuid not null references public.studio_projects (id) on delete cascade,
  episode_id      uuid references public.studio_episodes (id) on delete set null,
  provider        text not null default 'kie',
  task_id         text,
  status          text not null default 'queued' check (status in ('queued', 'running', 'finishing', 'done', 'failed')),
  ai_call_id      uuid references public.studio_ai_calls (id) on delete set null,
  credits_before  numeric(14,2),
  credits_after   numeric(14,2),
  topup           boolean not null default false,          -- balance went UP: a top-up, never negative spend
  error           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create index if not exists studio_jobs_project_idx on public.studio_jobs (project_id, status);

-- ------------------------------------------------------------------ takes
-- One generated (or imported) image for an asset, or (from Stage 5) for a panel.
--   exploration: cheap option. Labelled. Can never be used for a panel or published.
--   final:       panel art. Only allowed once the episode's Script final gate is approved.
--   imported:    made outside the studio before the gates (Morning Brew test pack).
create table if not exists public.studio_takes (
  id            uuid primary key default gen_random_uuid(),
  project_id    uuid not null references public.studio_projects (id) on delete cascade,
  episode_id    uuid references public.studio_episodes (id) on delete set null,
  asset_id      uuid references public.studio_assets (id) on delete cascade,
  panel_key     text,
  kind          text not null check (kind in ('exploration', 'final', 'imported')),
  status        text not null default 'pending' check (status in ('pending', 'ready', 'failed', 'dry_run')),
  prompt        text not null default '',
  model         text,
  size          text,
  aspect        text,
  cost_usd      numeric(10,4) not null default 0,
  ai_call_id    uuid references public.studio_ai_calls (id) on delete set null,
  job_id        uuid references public.studio_jobs (id) on delete set null,
  storage_path  text,
  comment       text,
  error         text,
  created_by    uuid references auth.users (id) default auth.uid(),
  created_at    timestamptz not null default now(),
  check (asset_id is not null or panel_key is not null)
);
create index if not exists studio_takes_asset_idx on public.studio_takes (asset_id, created_at);
create index if not exists studio_takes_job_idx on public.studio_takes (job_id);

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'studio_assets_picked_take_fk') then
    alter table public.studio_assets
      add constraint studio_assets_picked_take_fk
      foreign key (picked_take_id) references public.studio_takes (id) on delete set null;
  end if;
end $$;

-- ------------------------------------------------------------------ rule: takes
-- A "final" take needs the episode's Script final gate approved. A take's kind never changes,
-- so an exploration can't be turned into a final later.
create or replace function public.studio_guard_take()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and new.kind <> old.kind then
    raise exception 'A take''s kind can''t be changed (exploration stays exploration).';
  end if;
  if new.kind = 'final' and (tg_op = 'INSERT' or old.kind <> 'final') then
    if new.episode_id is null or not exists (
      select 1 from public.studio_gates g
       where g.episode_id = new.episode_id and g.gate = 'script_final' and g.state = 'approved'
    ) then
      raise exception 'No panel art before Script final: approve this episode''s script first.';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists studio_takes_guard on public.studio_takes;
create trigger studio_takes_guard
  before insert or update on public.studio_takes
  for each row execute function public.studio_guard_take();

-- ------------------------------------------------------------------ rule: picked design
-- An asset's picked design must be one of its own takes, with a real image.
create or replace function public.studio_guard_asset()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.picked_take_id is not null and (tg_op = 'INSERT' or new.picked_take_id is distinct from old.picked_take_id) then
    if not exists (
      select 1 from public.studio_takes t
       where t.id = new.picked_take_id and t.asset_id = new.id
         and t.status = 'ready' and t.storage_path is not null
    ) then
      raise exception 'Only a finished image of this asset can be picked.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studio_assets_guard on public.studio_assets;
create trigger studio_assets_guard
  before insert or update on public.studio_assets
  for each row execute function public.studio_guard_asset();

-- ------------------------------------------------------------------ rule: gates in order
-- A gate can only be approved when the one before it is approved:
-- Story approved -> Script final -> Asset designs approved -> Panels approved -> Publish.
create or replace function public.studio_guard_gate_order()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  need text;
begin
  if new.state <> 'approved' or (tg_op = 'UPDATE' and old.state = 'approved') then
    return new;
  end if;
  need := case new.gate
    when 'script_final'    then 'story_approved'
    when 'assets_approved' then 'script_final'
    when 'panels_approved' then 'assets_approved'
    when 'publish'         then 'panels_approved'
    else null end;
  if need is null then
    return new;
  end if;
  if need = 'story_approved' then
    if not exists (select 1 from public.studio_gates g
                    where g.project_id = new.project_id and g.episode_id is null
                      and g.gate = 'story_approved' and g.state = 'approved') then
      raise exception 'Gates go in order: approve the story first.';
    end if;
  elsif not exists (select 1 from public.studio_gates g
                     where g.project_id = new.project_id and g.episode_id = new.episode_id
                       and g.gate = need and g.state = 'approved') then
    raise exception 'Gates go in order: % must be approved first.', replace(need, '_', ' ');
  end if;
  return new;
end;
$$;
drop trigger if exists studio_gates_order on public.studio_gates;
create trigger studio_gates_order
  before insert or update on public.studio_gates
  for each row execute function public.studio_guard_gate_order();

-- ------------------------------------------------------------------ rule: staleness flows downstream
-- When an approved gate stops being approved, every approved gate after it (same episode;
-- for the story, every episode) turns stale, with a logged event. Cascades step by step.
create or replace function public.studio_cascade_stale()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  nxt text;
  g record;
begin
  if not (old.state = 'approved' and new.state <> 'approved') then
    return new;
  end if;
  nxt := case new.gate
    when 'story_approved'  then 'script_final'
    when 'script_final'    then 'assets_approved'
    when 'assets_approved' then 'panels_approved'
    when 'panels_approved' then 'publish'
    else null end;
  if nxt is null then
    return new;
  end if;
  for g in
    select id from public.studio_gates
     where project_id = new.project_id and gate = nxt and state = 'approved'
       and (new.gate = 'story_approved' or episode_id = new.episode_id)
  loop
    update public.studio_gates set state = 'stale', updated_at = now() where id = g.id;
    insert into public.studio_gate_events (gate_id, action, actor, note)
    values (g.id, 'stale', auth.uid(), format('Upstream gate "%s" changed.', replace(new.gate, '_', ' ')));
  end loop;
  return new;
end;
$$;
drop trigger if exists studio_gates_cascade on public.studio_gates;
create trigger studio_gates_cascade
  after update on public.studio_gates
  for each row execute function public.studio_cascade_stale();

-- ------------------------------------------------------------------ row-level security
do $$
declare t text;
begin
  foreach t in array array['studio_assets','studio_jobs','studio_takes'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "studio: admin only" on public.%I', t);
    execute format(
      'create policy "studio: admin only" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t);
  end loop;
end $$;

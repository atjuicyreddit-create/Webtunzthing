-- Pathtoon Studio — Stage 0 foundation.
-- Run once in Supabase: SQL Editor > New query > paste > Run. Safe to re-run.
-- Everything here is admin-only (public.is_admin()), and none of it touches the
-- public site's tables (series, episodes, panels, comments).

-- ------------------------------------------------------------------ settings
-- One row: model ids, price table, caps and the dry-run switch.
create table if not exists public.studio_settings (
  id          integer primary key default 1 check (id = 1),
  models      jsonb not null default '{
    "story":  "claude-fable-5-2",
    "small":  "claude-haiku-5-5",
    "vision": "claude-fable-5-2",
    "image":  "nano-banana-2"
  }'::jsonb,
  -- USD. Claude prices are per million tokens. Image prices are per image.
  prices      jsonb not null default '{
    "claude": {
      "claude-fable-5-2":  {"input": 8.00, "output": 40.00, "cache_read": 0.20},
      "claude-opus-5-5":   {"input": 4.00, "output": 20.00, "cache_read": 0.20},
      "claude-sonnet-5-5": {"input": 2.00, "output": 10.00, "cache_read": 0.10},
      "claude-haiku-5-5":  {"input": 0.10, "output": 0.50,  "cache_read": 0.01}
    },
    "image": {
      "nano-banana-2:1K": 0.04,
      "nano-banana-2:2K": 0.06
    }
  }'::jsonb,
  episode_image_cap_usd   numeric(10,4) not null default 2.50,
  episode_image_cap_gens  integer       not null default 40,
  episode_claude_cap_usd  numeric(10,4) not null default 3.00,
  -- A "session" is one calendar day, Europe/London, across all projects.
  session_cap_usd         numeric(10,4) not null default 10.00,
  warn_at                 numeric(4,3)  not null default 0.800,
  dry_run                 boolean       not null default true,
  updated_at              timestamptz   not null default now()
);
insert into public.studio_settings (id) values (1) on conflict (id) do nothing;

-- ------------------------------------------------------------------ projects
create table if not exists public.studio_projects (
  id                   uuid primary key default gen_random_uuid(),
  title                text not null check (char_length(btrim(title)) between 1 and 120),
  is_test              boolean not null default false,
  format               text not null default 'serial' check (format in ('one_off', 'serial')),
  idea                 text,
  published_series_id  uuid references public.series (id) on delete set null,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- A test project may never be linked to an existing (live) series.
-- Stage 7 adds the rest of this rule (new series only, address starting "test-").
create or replace function public.studio_guard_test_project()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.is_test and new.published_series_id is not null then
    if exists (
      select 1 from public.series s
      where s.id = new.published_series_id and s.slug not like 'test-%'
    ) then
      raise exception 'A test project can only publish to a series whose address starts with "test-".';
    end if;
  end if;
  new.updated_at := now();
  return new;
end;
$$;
drop trigger if exists studio_projects_guard on public.studio_projects;
create trigger studio_projects_guard
  before insert or update on public.studio_projects
  for each row execute function public.studio_guard_test_project();

-- ------------------------------------------------------------------ episodes
-- Minimal for now (caps live here). Stage 2 adds scenes and structure.
create table if not exists public.studio_episodes (
  id                    uuid primary key default gen_random_uuid(),
  project_id            uuid not null references public.studio_projects (id) on delete cascade,
  number                integer not null check (number > 0),
  title                 text not null default '',
  image_cap_usd         numeric(10,4),   -- null = use studio_settings default
  image_cap_gens        integer,
  claude_cap_usd        numeric(10,4),
  published_episode_id  uuid references public.episodes (id) on delete set null,
  created_at            timestamptz not null default now(),
  unique (project_id, number)
);

-- ------------------------------------------------------------------ gates
create table if not exists public.studio_gates (
  id           uuid primary key default gen_random_uuid(),
  project_id   uuid not null references public.studio_projects (id) on delete cascade,
  episode_id   uuid references public.studio_episodes (id) on delete cascade,
  gate         text not null check (gate in ('story_approved', 'script_final', 'assets_approved', 'panels_approved', 'publish')),
  state        text not null default 'open' check (state in ('open', 'approved', 'stale')),
  fingerprint  text,          -- hash of the content Tom approved
  approved_by  uuid references auth.users (id),
  approved_at  timestamptz,
  note         text,
  updated_at   timestamptz not null default now()
);
create unique index if not exists studio_gates_one_per_scope
  on public.studio_gates (project_id, coalesce(episode_id, '00000000-0000-0000-0000-000000000000'::uuid), gate);

create table if not exists public.studio_gate_events (
  id          uuid primary key default gen_random_uuid(),
  gate_id     uuid not null references public.studio_gates (id) on delete cascade,
  action      text not null check (action in ('approved', 'reopened', 'stale')),
  actor       uuid references auth.users (id),
  note        text,
  fingerprint text,
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ versions
create table if not exists public.studio_versions (
  id          uuid primary key default gen_random_uuid(),
  project_id  uuid not null references public.studio_projects (id) on delete cascade,
  item_type   text not null,   -- story | script | asset | panel | strip | ...
  item_id     text not null,
  version     integer not null,
  snapshot    jsonb not null,
  reason      text,
  cost_usd    numeric(10,4) not null default 0,
  created_by  uuid references auth.users (id),
  created_at  timestamptz not null default now(),
  unique (item_type, item_id, version)
);

-- ------------------------------------------------------------------ AI cost ledger
create table if not exists public.studio_ai_calls (
  id                uuid primary key default gen_random_uuid(),
  project_id        uuid references public.studio_projects (id) on delete set null,
  episode_id        uuid references public.studio_episodes (id) on delete set null,
  kind              text not null check (kind in ('claude', 'image')),
  purpose           text not null,
  model             text not null,
  size              text,                       -- images: 1K / 2K
  prompt            text,                       -- never contains keys
  status            text not null check (status in ('reserved', 'done', 'failed', 'dry_run', 'refused')),
  estimated_usd     numeric(10,4) not null default 0,
  actual_usd        numeric(10,4),
  input_tokens      integer,
  output_tokens     integer,
  cache_read_tokens integer,
  credits_before    numeric(14,2),
  credits_after     numeric(14,2),
  error             text,
  created_by        uuid references auth.users (id) default auth.uid(),
  created_at        timestamptz not null default now(),
  finished_at       timestamptz
);
create index if not exists studio_ai_calls_episode_idx on public.studio_ai_calls (episode_id, kind);
create index if not exists studio_ai_calls_day_idx on public.studio_ai_calls (created_at);

-- ------------------------------------------------------------------ lessons
create table if not exists public.studio_lessons (
  id          uuid primary key default gen_random_uuid(),
  stage       text not null,
  problem     text not null,
  cause       text,
  fix         text,
  lesson      text not null,
  tag         text not null check (tag in ('writing', 'art')),
  theme       text,       -- continuity | props | text | camera | unrequested | expressions | layout | lettering | process
  scope       text not null default 'global' check (scope in ('global', 'series', 'character')),
  scope_ref   text,
  status      text not null default 'proposed' check (status in ('proposed', 'approved', 'rejected')),
  active      boolean not null default false,
  source      text,       -- e.g. 'EDIT-LOG.md' or 'qa' or 'tom'
  created_at  timestamptz not null default now()
);

-- ------------------------------------------------------------------ row-level security
do $$
declare t text;
begin
  foreach t in array array[
    'studio_settings','studio_projects','studio_episodes','studio_gates',
    'studio_gate_events','studio_versions','studio_ai_calls','studio_lessons'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "studio: admin only" on public.%I', t);
    execute format(
      'create policy "studio: admin only" on public.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())',
      t);
  end loop;
end $$;

-- The ledger is append-only from the app: nobody edits or deletes spend history.
drop policy if exists "studio: admin only" on public.studio_ai_calls;
drop policy if exists "studio ledger: admin read" on public.studio_ai_calls;
create policy "studio ledger: admin read" on public.studio_ai_calls
  for select to authenticated using (public.is_admin());
-- (Inserts and updates go only through the two functions below.)

-- ------------------------------------------------------------------ cost reservation
-- Reserve the estimated cost of one AI call, or refuse it. Runs in one transaction
-- with a lock, so two calls at the same moment can't both slip under a cap.
create or replace function public.studio_reserve_ai_call(
  p_project_id uuid,
  p_episode_id uuid,
  p_kind text,
  p_purpose text,
  p_model text,
  p_size text,
  p_prompt text,
  p_estimated_usd numeric
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  s            public.studio_settings%rowtype;
  ep           public.studio_episodes%rowtype;
  cap_usd      numeric;
  cap_gens     integer;
  spent_ep     numeric := 0;
  gens_ep      integer := 0;
  spent_day    numeric := 0;
  day_start    timestamptz;
  new_id       uuid;
  is_dry       boolean;
  pct          numeric := 0;
  warn         boolean := false;
begin
  if not public.is_admin() then
    raise exception 'Only an admin can use the studio.';
  end if;
  if p_kind not in ('claude', 'image') then
    raise exception 'Unknown call kind %', p_kind;
  end if;
  if p_estimated_usd is null or p_estimated_usd < 0 then
    raise exception 'Estimated cost is missing.';
  end if;

  -- One lock for the whole studio: calls are rare, and this keeps caps exact.
  perform pg_advisory_xact_lock(hashtext('studio_ai_calls'));

  select * into s from public.studio_settings where id = 1;
  is_dry := s.dry_run;

  day_start := (date_trunc('day', now() at time zone 'Europe/London')) at time zone 'Europe/London';
  select coalesce(sum(coalesce(actual_usd, estimated_usd)), 0) into spent_day
    from public.studio_ai_calls
   where created_at >= day_start and status in ('reserved', 'done');

  if not is_dry and spent_day + p_estimated_usd > s.session_cap_usd then
    insert into public.studio_ai_calls (project_id, episode_id, kind, purpose, model, size, prompt, status, estimated_usd, error, finished_at)
    values (p_project_id, p_episode_id, p_kind, p_purpose, p_model, p_size, p_prompt, 'refused', p_estimated_usd,
            format('Daily cap: $%s spent of $%s today.', round(spent_day, 2), s.session_cap_usd), now());
    return jsonb_build_object('ok', false, 'reason',
      format('This would go over today''s studio limit ($%s of $%s used). Raise it in Studio settings, or wait until tomorrow.',
             round(spent_day, 2), s.session_cap_usd));
  end if;

  if p_episode_id is not null then
    select * into ep from public.studio_episodes where id = p_episode_id;
    if p_kind = 'image' then
      cap_usd := coalesce(ep.image_cap_usd, s.episode_image_cap_usd);
      cap_gens := coalesce(ep.image_cap_gens, s.episode_image_cap_gens);
    else
      cap_usd := coalesce(ep.claude_cap_usd, s.episode_claude_cap_usd);
    end if;
    select coalesce(sum(coalesce(actual_usd, estimated_usd)), 0), count(*)
      into spent_ep, gens_ep
      from public.studio_ai_calls
     where episode_id = p_episode_id and kind = p_kind and status in ('reserved', 'done');

    if not is_dry and spent_ep + p_estimated_usd > cap_usd then
      insert into public.studio_ai_calls (project_id, episode_id, kind, purpose, model, size, prompt, status, estimated_usd, error, finished_at)
      values (p_project_id, p_episode_id, p_kind, p_purpose, p_model, p_size, p_prompt, 'refused', p_estimated_usd,
              format('Episode %s cap: $%s of $%s.', p_kind, round(spent_ep, 2), cap_usd), now());
      return jsonb_build_object('ok', false, 'reason',
        format('This would go over the episode''s %s budget ($%s of $%s used).',
               case when p_kind = 'image' then 'image' else 'Claude' end, round(spent_ep, 2), cap_usd));
    end if;
    if not is_dry and p_kind = 'image' and cap_gens is not null and gens_ep + 1 > cap_gens then
      insert into public.studio_ai_calls (project_id, episode_id, kind, purpose, model, size, prompt, status, estimated_usd, error, finished_at)
      values (p_project_id, p_episode_id, p_kind, p_purpose, p_model, p_size, p_prompt, 'refused', p_estimated_usd,
              format('Episode generation cap: %s of %s.', gens_ep, cap_gens), now());
      return jsonb_build_object('ok', false, 'reason',
        format('This episode has used %s of its %s image generations.', gens_ep, cap_gens));
    end if;
    if cap_usd > 0 then
      pct := (spent_ep + p_estimated_usd) / cap_usd;
    end if;
  end if;

  if s.session_cap_usd > 0 then
    pct := greatest(pct, (spent_day + p_estimated_usd) / s.session_cap_usd);
  end if;
  warn := not is_dry and pct >= s.warn_at;

  insert into public.studio_ai_calls (project_id, episode_id, kind, purpose, model, size, prompt, status, estimated_usd, finished_at)
  values (p_project_id, p_episode_id, p_kind, p_purpose, p_model, p_size, p_prompt,
          case when is_dry then 'dry_run' else 'reserved' end, p_estimated_usd,
          case when is_dry then now() else null end)
  returning id into new_id;

  return jsonb_build_object('ok', true, 'id', new_id, 'dry_run', is_dry,
                            'warn', warn, 'percent', round(pct * 100));
end;
$$;

-- Record how a reserved call ended (actual cost, tokens, credits, or the error).
create or replace function public.studio_finish_ai_call(
  p_id uuid,
  p_status text,
  p_actual_usd numeric,
  p_input_tokens integer,
  p_output_tokens integer,
  p_cache_read_tokens integer,
  p_credits_before numeric,
  p_credits_after numeric,
  p_error text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Only an admin can use the studio.';
  end if;
  if p_status not in ('done', 'failed') then
    raise exception 'Finish status must be done or failed.';
  end if;
  update public.studio_ai_calls
     set status = p_status,
         actual_usd = case when p_status = 'failed' then coalesce(p_actual_usd, 0) else p_actual_usd end,
         input_tokens = p_input_tokens,
         output_tokens = p_output_tokens,
         cache_read_tokens = p_cache_read_tokens,
         credits_before = p_credits_before,
         credits_after = p_credits_after,
         error = left(p_error, 500),
         finished_at = now()
   where id = p_id and status = 'reserved';
end;
$$;

revoke all on function public.studio_reserve_ai_call(uuid, uuid, text, text, text, text, text, numeric) from public, anon;
revoke all on function public.studio_finish_ai_call(uuid, text, numeric, integer, integer, integer, numeric, numeric, text) from public, anon;
grant execute on function public.studio_reserve_ai_call(uuid, uuid, text, text, text, text, text, numeric) to authenticated;
grant execute on function public.studio_finish_ai_call(uuid, text, numeric, integer, integer, integer, numeric, numeric, text) to authenticated;

-- ------------------------------------------------------------------ storage (private bucket)
-- Studio art (references, takes, lettered panels, strips) stays private until publish.
-- This section touches the storage schema.
insert into storage.buckets (id, name, public)
values ('studio', 'studio', false)
on conflict (id) do update set public = false;

drop policy if exists "studio bucket: admin read" on storage.objects;
create policy "studio bucket: admin read" on storage.objects
  for select to authenticated using (bucket_id = 'studio' and public.is_admin());
drop policy if exists "studio bucket: admin upload" on storage.objects;
create policy "studio bucket: admin upload" on storage.objects
  for insert to authenticated with check (bucket_id = 'studio' and public.is_admin());
drop policy if exists "studio bucket: admin update" on storage.objects;
create policy "studio bucket: admin update" on storage.objects
  for update to authenticated using (bucket_id = 'studio' and public.is_admin());
drop policy if exists "studio bucket: admin delete" on storage.objects;
create policy "studio bucket: admin delete" on storage.objects
  for delete to authenticated using (bucket_id = 'studio' and public.is_admin());

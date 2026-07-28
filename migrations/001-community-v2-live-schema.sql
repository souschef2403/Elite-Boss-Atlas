-- Elite Boss Atlas v2.2 — migration matched to the LIVE Supabase schema
-- Existing objects confirmed:
--   public.bosses
--   public.boss_confirmations (confirmed_at)
--   public.profiles
--   public.contributor_leaderboard (user_id, display_name, bosses_added,
--                                  bosses_confirmed, score)
-- This migration preserves all existing rows, pins, users, confirmations and images.
-- Safe to rerun. Run the entire file in Supabase > SQL Editor > New query.

begin;
create extension if not exists pgcrypto;

-- Add moderation to the existing profiles table.
alter table public.profiles
  add column if not exists is_moderator boolean not null default false;

-- Ensure every existing Auth user has a profile without overwriting existing names.
insert into public.profiles (id, display_name)
select
  u.id,
  coalesce(nullif(u.raw_user_meta_data->>'display_name', ''), 'Community member')
from auth.users u
on conflict (id) do nothing;

-- Community-learned spawn observations.
create table if not exists public.spawn_observations (
  id uuid primary key default gen_random_uuid(),
  boss_id uuid not null references public.bosses(id) on delete cascade,
  defeated_at timestamptz not null,
  respawned_at timestamptz not null,
  elapsed_minutes integer generated always as (
    greatest(0, round(extract(epoch from (respawned_at - defeated_at)) / 60)::integer)
  ) stored,
  evidence_url text not null default '',
  notes text not null default '',
  review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected','needs_evidence')),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  check (respawned_at > defeated_at)
);

-- General community corrections and additions.
create table if not exists public.community_submissions (
  id uuid primary key default gen_random_uuid(),
  submission_type text not null
    check (submission_type in ('new_boss','location_update','loot_update','strategy_update','other')),
  boss_id uuid references public.bosses(id) on delete set null,
  boss_name text not null default '',
  region text not null default '',
  grid text not null default '',
  details text not null,
  evidence_url text not null default '',
  review_status text not null default 'pending'
    check (review_status in ('pending','approved','rejected','needs_evidence','duplicate')),
  submitted_by uuid not null references auth.users(id) on delete cascade,
  reviewed_by uuid references auth.users(id) on delete set null,
  reviewed_at timestamptz,
  reviewer_notes text not null default '',
  created_at timestamptz not null default now()
);

create index if not exists spawn_observations_boss_status_idx
  on public.spawn_observations (boss_id, review_status);
create index if not exists spawn_observations_submitted_by_idx
  on public.spawn_observations (submitted_by);
create index if not exists community_submissions_status_idx
  on public.community_submissions (review_status, created_at);

-- Keep profiles updated for future sign-ups.
create or replace function public.create_profile_for_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data->>'display_name', ''), 'Community member')
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.create_profile_for_new_user();

create or replace function public.is_moderator()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    (select p.is_moderator from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

-- Learned timer statistics used by the website.
create or replace view public.boss_timer_stats as
select
  b.id as boss_id,
  count(o.id)::integer as approved_observations,
  min(o.elapsed_minutes)::integer as observed_min,
  round(avg(o.elapsed_minutes))::integer as observed_average,
  max(o.elapsed_minutes)::integer as observed_max,
  case
    when count(o.id) = 0 then 'Unknown'
    when count(o.id) < 3 then 'Early estimate'
    when count(o.id) < 6 then 'Developing'
    else 'Community verified'
  end as timer_confidence
from public.bosses b
left join public.spawn_observations o
  on o.boss_id = b.id
 and o.review_status = 'approved'
group by b.id;

-- Preserve the LIVE leaderboard's existing five columns in the same order and
-- append observations_approved as the sixth column. This avoids error 42P16.
create or replace view public.contributor_leaderboard as
with boss_counts as (
  select created_by as user_id, count(*)::integer as bosses_added
  from public.bosses
  where created_by is not null
  group by created_by
),
confirmation_counts as (
  select user_id, count(*)::integer as bosses_confirmed
  from public.boss_confirmations
  group by user_id
),
observation_counts as (
  select submitted_by as user_id, count(*)::integer as observations_approved
  from public.spawn_observations
  where review_status = 'approved'
  group by submitted_by
)
select
  p.id as user_id,
  p.display_name,
  coalesce(bc.bosses_added, 0)::integer as bosses_added,
  coalesce(cc.bosses_confirmed, 0)::integer as bosses_confirmed,
  (
    coalesce(bc.bosses_added, 0) * 3
    + coalesce(cc.bosses_confirmed, 0)
    + coalesce(oc.observations_approved, 0) * 2
  )::integer as score,
  coalesce(oc.observations_approved, 0)::integer as observations_approved
from public.profiles p
left join boss_counts bc on bc.user_id = p.id
left join confirmation_counts cc on cc.user_id = p.id
left join observation_counts oc on oc.user_id = p.id;

alter table public.profiles enable row level security;
alter table public.bosses enable row level security;
alter table public.boss_confirmations enable row level security;
alter table public.spawn_observations enable row level security;
alter table public.community_submissions enable row level security;

-- Drop only recognised old/v2 policy names, then recreate the intended rules.
drop policy if exists "Profiles are publicly readable" on public.profiles;
drop policy if exists "Users update own profile" on public.profiles;
create policy "Profiles are publicly readable"
  on public.profiles for select to anon, authenticated using (true);
create policy "Users update own profile"
  on public.profiles for update to authenticated
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Public boss reading; moderator-only direct edits.
drop policy if exists "Anyone can view bosses" on public.bosses;
drop policy if exists "Guild members can add bosses" on public.bosses;
drop policy if exists "Guild members can update bosses" on public.bosses;
drop policy if exists "Guild members can delete bosses" on public.bosses;
drop policy if exists "Moderators add bosses" on public.bosses;
drop policy if exists "Moderators update bosses" on public.bosses;
drop policy if exists "Moderators delete bosses" on public.bosses;
create policy "Anyone can view bosses"
  on public.bosses for select to anon, authenticated using (true);
create policy "Moderators add bosses"
  on public.bosses for insert to authenticated
  with check (public.is_moderator());
create policy "Moderators update bosses"
  on public.bosses for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());
create policy "Moderators delete bosses"
  on public.bosses for delete to authenticated
  using (public.is_moderator());

-- Existing confirmations remain public/readable and signed-in users can confirm.
drop policy if exists "Anyone can view confirmations" on public.boss_confirmations;
drop policy if exists "Users confirm bosses" on public.boss_confirmations;
create policy "Anyone can view confirmations"
  on public.boss_confirmations for select to anon, authenticated using (true);
create policy "Users confirm bosses"
  on public.boss_confirmations for insert to authenticated
  with check (auth.uid() = user_id);

-- Observation workflow.
drop policy if exists "Approved observations are public" on public.spawn_observations;
drop policy if exists "Users view own or approved observations" on public.spawn_observations;
drop policy if exists "Users submit observations" on public.spawn_observations;
drop policy if exists "Moderators review observations" on public.spawn_observations;
create policy "Approved observations are public"
  on public.spawn_observations for select to anon
  using (review_status = 'approved');
create policy "Users view own or approved observations"
  on public.spawn_observations for select to authenticated
  using (review_status = 'approved' or submitted_by = auth.uid() or public.is_moderator());
create policy "Users submit observations"
  on public.spawn_observations for insert to authenticated
  with check (submitted_by = auth.uid() and review_status = 'pending');
create policy "Moderators review observations"
  on public.spawn_observations for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- General submission workflow.
drop policy if exists "Users view own submissions" on public.community_submissions;
drop policy if exists "Users create submissions" on public.community_submissions;
drop policy if exists "Moderators review submissions" on public.community_submissions;
create policy "Users view own submissions"
  on public.community_submissions for select to authenticated
  using (submitted_by = auth.uid() or public.is_moderator());
create policy "Users create submissions"
  on public.community_submissions for insert to authenticated
  with check (submitted_by = auth.uid() and review_status = 'pending');
create policy "Moderators review submissions"
  on public.community_submissions for update to authenticated
  using (public.is_moderator()) with check (public.is_moderator());

-- Privileges. RLS still decides which rows/actions are permitted.
grant usage on schema public to anon, authenticated;
grant select on public.bosses, public.profiles, public.boss_confirmations,
  public.boss_timer_stats, public.contributor_leaderboard to anon, authenticated;
grant select, insert on public.spawn_observations, public.community_submissions to authenticated;
grant update on public.spawn_observations, public.community_submissions to authenticated;
grant insert on public.boss_confirmations to authenticated;
grant insert, update, delete on public.bosses to authenticated;
revoke update on public.profiles from authenticated;
grant update (display_name) on public.profiles to authenticated;

-- Existing public image bucket, with the owner_id text/UUID comparison corrected.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'boss-images', 'boss-images', true, 10485760,
  array['image/jpeg','image/png','image/webp','image/gif']
)
on conflict (id) do update
set public = true,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "Public can view boss images" on storage.objects;
drop policy if exists "Guild members can upload boss images" on storage.objects;
drop policy if exists "Guild members can update boss images" on storage.objects;
drop policy if exists "Guild members can delete boss images" on storage.objects;
drop policy if exists "Authenticated users upload boss images" on storage.objects;
drop policy if exists "Owners or moderators update images" on storage.objects;
drop policy if exists "Owners or moderators delete images" on storage.objects;
create policy "Public can view boss images"
  on storage.objects for select to public
  using (bucket_id = 'boss-images');
create policy "Authenticated users upload boss images"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'boss-images');
create policy "Owners or moderators update images"
  on storage.objects for update to authenticated
  using (
    bucket_id = 'boss-images'
    and (owner_id = auth.uid()::text or public.is_moderator())
  );
create policy "Owners or moderators delete images"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'boss-images'
    and (owner_id = auth.uid()::text or public.is_moderator())
  );

-- Add new tables to Realtime once; duplicate additions are ignored.
do $$
begin
  alter publication supabase_realtime add table public.spawn_observations;
exception when duplicate_object then null;
end $$;
do $$
begin
  alter publication supabase_realtime add table public.community_submissions;
exception when duplicate_object then null;
end $$;

commit;

-- After the migration succeeds, promote your own account in a SEPARATE query:
-- update public.profiles
-- set is_moderator = true
-- where id = 'YOUR_AUTH_USER_UUID';

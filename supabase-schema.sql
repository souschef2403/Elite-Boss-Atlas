-- Run this entire file in Supabase > SQL Editor > New query.
create extension if not exists pgcrypto;

create table if not exists public.bosses (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  type text not null default 'Elite Boss',
  status text not null default 'Unconfirmed',
  region text default '',
  grid text default '',
  landmark text default '',
  level text default '',
  difficulty text default '★★★☆☆',
  party text default '',
  confirmed_by text default '',
  respawn_min integer not null default 0 check (respawn_min >= 0),
  respawn_max integer not null default 0 check (respawn_max >= 0),
  last_seen timestamptz,
  drops text default '',
  weaknesses text default '',
  strategy text default '',
  notes text default '',
  x numeric(8,4) not null default 50 check (x between 0 and 100),
  y numeric(8,4) not null default 50 check (y between 0 and 100),
  image_url text,
  created_by uuid references auth.users(id) on delete set null,
  updated_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = '' as $$
begin new.updated_at = now(); return new; end; $$;
drop trigger if exists bosses_set_updated_at on public.bosses;
create trigger bosses_set_updated_at before update on public.bosses for each row execute function public.set_updated_at();

alter table public.bosses enable row level security;
drop policy if exists "Anyone can view bosses" on public.bosses;
drop policy if exists "Guild members can add bosses" on public.bosses;
drop policy if exists "Guild members can update bosses" on public.bosses;
drop policy if exists "Guild members can delete bosses" on public.bosses;
create policy "Anyone can view bosses" on public.bosses for select to anon, authenticated using (true);
create policy "Guild members can add bosses" on public.bosses for insert to authenticated with check (auth.uid() = created_by);
create policy "Guild members can update bosses" on public.bosses for update to authenticated using (true) with check (auth.uid() = updated_by);
create policy "Guild members can delete bosses" on public.bosses for delete to authenticated using (true);

grant usage on schema public to anon, authenticated;
grant select on public.bosses to anon;
grant select, insert, update, delete on public.bosses to authenticated;

insert into storage.buckets (id,name,public,file_size_limit,allowed_mime_types)
values ('boss-images','boss-images',true,10485760,array['image/jpeg','image/png','image/webp','image/gif'])
on conflict (id) do update set public=true, file_size_limit=10485760;

drop policy if exists "Public can view boss images" on storage.objects;
drop policy if exists "Guild members can upload boss images" on storage.objects;
drop policy if exists "Guild members can update boss images" on storage.objects;
drop policy if exists "Guild members can delete boss images" on storage.objects;
create policy "Public can view boss images" on storage.objects for select to public using (bucket_id='boss-images');
create policy "Guild members can upload boss images" on storage.objects for insert to authenticated with check (bucket_id='boss-images');
create policy "Guild members can update boss images" on storage.objects for update to authenticated using (bucket_id='boss-images');
create policy "Guild members can delete boss images" on storage.objects for delete to authenticated using (bucket_id='boss-images');

do $$ begin
  alter publication supabase_realtime add table public.bosses;
exception when duplicate_object then null;
end $$;

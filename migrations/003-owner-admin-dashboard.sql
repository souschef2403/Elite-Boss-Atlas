-- Elite Boss Atlas v2.4 owner/admin dashboard
begin;
alter table public.profiles add column if not exists is_owner boolean not null default false;
create or replace function public.is_owner() returns boolean language sql stable security definer set search_path=public as $$ select coalesce((select p.is_owner from public.profiles p where p.id=auth.uid()),false); $$;
create or replace function public.set_user_moderator(target_user_id uuid, moderator_enabled boolean) returns void language plpgsql security definer set search_path=public as $$
begin
  if not public.is_owner() then raise exception 'Owner access required'; end if;
  if not exists(select 1 from public.profiles where id=target_user_id) then raise exception 'Profile not found'; end if;
  if exists(select 1 from public.profiles where id=target_user_id and is_owner) then raise exception 'The owner role is protected'; end if;
  update public.profiles set is_moderator=moderator_enabled,updated_at=now() where id=target_user_id;
end; $$;
revoke all on function public.set_user_moderator(uuid,boolean) from public,anon;
grant execute on function public.set_user_moderator(uuid,boolean) to authenticated;
grant execute on function public.is_owner() to anon,authenticated;
commit;
-- Run separately after success:
-- update public.profiles p set is_owner=true,is_moderator=true,updated_at=now() from auth.users u where p.id=u.id and lower(u.email)=lower('souschef2403@outlook.com');

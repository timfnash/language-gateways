-- Admin page: remove a person. Deletes their account (and with it their profile, notes and progress,
-- which cascade from auth.users) and their invitation. Admins can't be removed this way, so an admin
-- can't remove themselves or another admin by mistake: take them out of public.admins first.
-- Returns 'account' (an account was deleted), 'invitation' (only an invitation) or 'none'.

create function public.admin_remove_person(p_email text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  e text := lower(trim(p_email));
  removed text := 'none';
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if exists (select 1 from public.admins where email = e) then
    raise exception 'That person is an admin. Remove them from the admins table in Supabase first.'
      using errcode = 'insufficient_privilege';
  end if;

  delete from auth.users where lower(email) = e;
  if found then removed := 'account'; end if;

  delete from public.invitations where email = e;
  if found and removed = 'none' then removed := 'invitation'; end if;

  return removed;
end;
$$;

revoke execute on function public.admin_remove_person(text) from public, anon;
grant  execute on function public.admin_remove_person(text) to authenticated;

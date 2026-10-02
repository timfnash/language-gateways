-- Admin page: see who the admins are, and grant or remove admin rights.
-- Safety: you can't remove your own admin rights, and the last admin can't be removed.

create function public.admin_list_admins()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query select email from public.admins order by email;
end;
$$;

create function public.admin_set_admin(p_email text, p_admin boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  e text := lower(trim(p_email));
  me text := (select lower(email) from auth.users where id = auth.uid());
begin
  if not public.is_admin() then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  if p_admin then
    insert into public.admins (email) values (e) on conflict (email) do nothing;
  else
    if e = me then
      raise exception 'You can''t remove your own admin rights. Ask another admin to do it.'
        using errcode = 'insufficient_privilege';
    end if;
    if (select count(*) from public.admins) <= 1 and exists (select 1 from public.admins where email = e) then
      raise exception 'There must always be at least one admin.' using errcode = 'insufficient_privilege';
    end if;
    delete from public.admins where email = e;
  end if;
end;
$$;

revoke execute on function public.admin_list_admins()               from public, anon;
grant  execute on function public.admin_list_admins()               to authenticated;
revoke execute on function public.admin_set_admin(text, boolean)    from public, anon;
grant  execute on function public.admin_set_admin(text, boolean)    to authenticated;

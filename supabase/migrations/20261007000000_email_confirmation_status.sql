-- Admin page: show who hasn't confirmed their email address yet, so admins can tell real join requests
-- from abandoned ones (e.g. a mistyped address), and the invitations list doesn't count unconfirmed
-- accounts as joined.

drop function public.admin_join_requests();
create function public.admin_join_requests()
returns table (id uuid, email text, given_name text, family_name text, mother_tongue text,
               other_languages text, church text, cohort text, created_at timestamptz, email_confirmed boolean)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.my_admin_church() is not null) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.id, p.email, p.given_name, p.family_name, p.mother_tongue, p.other_languages, p.church, p.cohort,
           p.created_at, u.email_confirmed_at is not null
    from public.profiles p
    join auth.users u on u.id = p.id
    where p.status = 'pending' and public.can_manage_church(p.church)
    order by p.created_at;
end;
$$;

-- Emails of accounts (in churches the caller manages) that haven't confirmed their address yet.
create function public.admin_unconfirmed_emails()
returns setof text
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.my_admin_church() is not null) then
    raise exception 'Admins only.' using errcode = 'insufficient_privilege';
  end if;
  return query
    select p.email from public.profiles p
    join auth.users u on u.id = p.id
    where u.email_confirmed_at is null and public.can_manage_church(p.church);
end;
$$;

revoke execute on function public.admin_join_requests()       from public, anon;
grant  execute on function public.admin_join_requests()       to authenticated;
revoke execute on function public.admin_unconfirmed_emails()  from public, anon;
grant  execute on function public.admin_unconfirmed_emails()  to authenticated;

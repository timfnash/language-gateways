-- Unsubscribing from admin emails (the Admin page's "Email selected").
--
-- Every invited person has a random unsubscribe code. Each admin email links to unsubscribe.html with that code
-- (never the email address), where one click unsubscribes them, without signing in. People can opt back in on
-- their Profile page. Admins (and church admins, for their church) see who has unsubscribed; the send-email
-- Edge Function skips them. Account emails (confirm your email, password reset, "You're in") are not affected.
--
-- The codes live in their own table with no policies, so only these functions and the service role can read them:
-- nobody can unsubscribe someone else by reading their code.

create table public.email_preferences (
  email            text primary key references public.invitations (email) on update cascade on delete cascade,
  unsubscribe_code uuid not null unique default gen_random_uuid(),
  unsubscribed_at  timestamptz
);
alter table public.email_preferences enable row level security;

insert into public.email_preferences (email) select email from public.invitations on conflict do nothing;

create function public.add_email_preferences()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.email_preferences (email) values (new.email) on conflict do nothing;
  return new;
end;
$$;
create trigger invitations_email_preferences
  after insert on public.invitations
  for each row execute function public.add_email_preferences();

-- The unsubscribe page: p_unsubscribe true to unsubscribe, false to opt back in. Answers whether the code was valid.
create function public.set_unsubscribed(p_code uuid, p_unsubscribe boolean)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_preferences
     set unsubscribed_at = case when p_unsubscribe then coalesce(unsubscribed_at, now()) end
   where unsubscribe_code = p_code;
  return found;
end;
$$;

-- The Profile page: am I unsubscribed, and changing it.
create function public.my_unsubscribed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select ep.unsubscribed_at is not null
  from public.email_preferences ep
  join auth.users u on lower(u.email) = ep.email
  where u.id = auth.uid();
$$;

create function public.set_my_unsubscribed(p_unsubscribe boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.email_preferences ep
     set unsubscribed_at = case when p_unsubscribe then coalesce(ep.unsubscribed_at, now()) end
    from auth.users u
   where u.id = auth.uid() and lower(u.email) = ep.email;
end;
$$;

-- The Admin page: who has unsubscribed, in churches the caller manages.
create function public.admin_unsubscribed_emails()
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
    select ep.email from public.email_preferences ep
    join public.invitations i on i.email = ep.email
    where ep.unsubscribed_at is not null and public.can_manage_church(i.church);
end;
$$;

revoke execute on function public.add_email_preferences()            from public, anon, authenticated;
revoke execute on function public.set_unsubscribed(uuid, boolean)     from public;
grant  execute on function public.set_unsubscribed(uuid, boolean)     to anon, authenticated;
revoke execute on function public.my_unsubscribed()                   from public, anon;
grant  execute on function public.my_unsubscribed()                   to authenticated;
revoke execute on function public.set_my_unsubscribed(boolean)        from public, anon;
grant  execute on function public.set_my_unsubscribed(boolean)        to authenticated;
revoke execute on function public.admin_unsubscribed_emails()         from public, anon;
grant  execute on function public.admin_unsubscribed_emails()         to authenticated;
